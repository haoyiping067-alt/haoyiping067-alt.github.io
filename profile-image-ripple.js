import * as THREE from "./assets/vendor/three.module.js";
import { subscribeVisualFrame } from "./scroll-system.js?v=target-scroll-4";
import { TargetFluidSimulation } from "./target-hover-ripple.js?v=target-hover-ripple-6";

const CAMERA_DISTANCE = 800;
const MAX_PIXEL_RATIO = 1;
const MESH_OVERSCAN = 0;
const SIMULATION_RESIZE_SETTLE_DELAY = 160;
const MAX_TEXTURE_WIDTH = 1600;

export function initGlobalWebGLImages(images) {
  const imageList = Array.from(images || []).filter((candidate) =>
    candidate.matches("img.webgl[data-fluid-figure]"),
  );
  const initialViewport = getViewportSize();
  if (!imageList.length || !THREE.WebGLRenderer || initialViewport.width <= 1024) return;

  const canvas = document.createElement("canvas");
  canvas.className = "webgl-ripple-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
  } catch {
    canvas.remove();
    return;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(getPixelRatio());
  // The reference keeps one shared scene and clears it explicitly only after
  // the fluid passes. Leaving autoClear enabled erases the additive force pass
  // as soon as the next simulation pass is rendered, so the wake never gains
  // the continuous, elastic motion of the source implementation.
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
  camera.position.z = CAMERA_DISTANCE;

  const simulation = new TargetFluidSimulation(renderer);
  const geometry = new THREE.PlaneGeometry(1, 1, 16, 16);
  const records = imageList.map((image) => {
    const layoutElement = image.closest("[data-ripple-frame]") || image.closest(".project-card-media") || image;
    const enableHoverParallax = image.hasAttribute("data-hover-parallax");
    const baseScale = Number.parseFloat(image.dataset.baseScale || "");
    const hoverScale = Number.parseFloat(image.dataset.hoverScale || "");
    const mediaOffsetX = Number.parseFloat(image.dataset.mediaOffsetX || "");
    const mediaOffsetY = Number.parseFloat(image.dataset.mediaOffsetY || "");
    const objectPositionY = Number.parseFloat(image.dataset.objectPositionY || "");
    const cornerRadius = Number.parseFloat(image.dataset.cornerRadius || "");
    const meshOverscan = image.classList.contains("project-ripple-image") ? 0 : MESH_OVERSCAN;
    const uniforms = {
      uTexture: { value: null },
      uFluidVelocity: { value: simulation.texture },
      uMouseL: { value: new THREE.Vector2(0, 0) },
      uObjectCenter: { value: new THREE.Vector2(0, 0) },
      uHoverLerp: { value: 0 },
      uBaseScale: { value: Number.isFinite(baseScale) ? Math.max(baseScale, 1) : 1 },
      uHoverScale: {
        value: Number.isFinite(hoverScale) ? hoverScale : enableHoverParallax ? 0.05 : 0,
      },
      uMediaOffset: {
        value: new THREE.Vector2(
          Number.isFinite(mediaOffsetX) ? mediaOffsetX : 0,
          Number.isFinite(mediaOffsetY) ? mediaOffsetY : 0,
        ),
      },
      uFluidStrength: { value: 0.5 },
      uEnableRgb: { value: image.hasAttribute("data-rgb") ? 1 : 0 },
      uEnableHoverParallax: { value: enableHoverParallax ? 1 : 0 },
      uObjectPositionY: { value: Number.isFinite(objectPositionY) ? objectPositionY : 0.5 },
      uImageSize: { value: new THREE.Vector2(1, 1) },
      uTextureSize: {
        value: new THREE.Vector2(
          image.naturalWidth || Number(image.getAttribute("width")) || 1,
          image.naturalHeight || Number(image.getAttribute("height")) || 1,
        ),
      },
      uViewport: { value: new THREE.Vector2(initialViewport.width, initialViewport.height) },
      uCornerRadius: { value: Number.isFinite(cornerRadius) ? cornerRadius : 20 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: imageVertexShader,
      fragmentShader: imageFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);

    return {
      image,
      layoutElement,
      material,
      mesh,
      uniforms,
      texture: null,
      activated: false,
      ready: false,
      failed: false,
      visible: false,
      hoverTarget: 0,
      hover: 0,
      hoverStart: 0,
      hoverStartedAt: 0,
      imageRect: new DOMRect(),
      meshOverscan,
      lastWidth: 0,
      lastHeight: 0,
      lastTop: Number.NaN,
      lastLeft: Number.NaN,
      documentTop: 0,
      documentLeft: 0,
      needsMeasure: true,
      dynamicLayout: Boolean(
        image.hasAttribute("data-ripple-dynamic") ||
          image.closest("[data-scroll-gallery], [data-highlight-slider]"),
      ),
    };
  });
  const recordByElement = new Map(records.map((record) => [record.layoutElement, record]));

  const targetMouseNdc = new THREE.Vector2(0, 0);
  const smoothMouseNdc = new THREE.Vector2(0, 0);
  const previousPointerUv = new THREE.Vector2(0.5, 0.5);
  const pendingPointerDelta = new THREE.Vector2(0, 0);
  const exactPointerDelta = new THREE.Vector2(0, 0);
  let dirty = true;
  let destroyed = false;
  let lastScroll = Number.NaN;
  let rendererWidth = 0;
  let rendererHeight = 0;
  let rendererPixelRatio = 0;
  let simulationResizeTimer = 0;
  let hasInteractiveRecords = false;

  function updatePointer(event) {
    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    const nextPointerUvX = event.clientX / viewportWidth;
    const nextPointerUvY = 1 - event.clientY / viewportHeight;

    if (!hasInteractiveRecords) {
      previousPointerUv.set(nextPointerUvX, nextPointerUvY);
      targetMouseNdc.set(nextPointerUvX * 2 - 1, nextPointerUvY * 2 - 1);
      pendingPointerDelta.set(0, 0);
      return;
    }

    pendingPointerDelta.x += nextPointerUvX - previousPointerUv.x;
    pendingPointerDelta.y += nextPointerUvY - previousPointerUv.y;
    previousPointerUv.set(nextPointerUvX, nextPointerUvY);

    targetMouseNdc.set(nextPointerUvX * 2 - 1, nextPointerUvY * 2 - 1);
    const now = performance.now();
    records.forEach((record) => {
      if (!record.visible || !record.ready || record.failed) return;
      const nextHoverTarget =
        isPointInsideRect(event.clientX, event.clientY, record.imageRect)
          ? 1
          : 0;
      if (nextHoverTarget === record.hoverTarget) return;
      record.hoverStart = record.hover;
      record.hoverStartedAt = now;
      record.hoverTarget = nextHoverTarget;
    });
  }

  function clearPointerHover() {
    const now = performance.now();
    records.forEach((record) => {
      if (record.hoverTarget === 0) return;
      record.hoverStart = record.hover;
      record.hoverStartedAt = now;
      record.hoverTarget = 0;
    });
  }

  function resizeRenderer(viewportWidth, viewportHeight, resizeSimulation = false) {
    const pixelRatio = getPixelRatio();
    const rendererSizeChanged = !(
      viewportWidth === rendererWidth &&
      viewportHeight === rendererHeight &&
      pixelRatio === rendererPixelRatio
    );

    if (rendererSizeChanged) {
      rendererWidth = viewportWidth;
      rendererHeight = viewportHeight;
      rendererPixelRatio = pixelRatio;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(viewportWidth, viewportHeight, false);
      camera.aspect = viewportWidth / viewportHeight;
      camera.fov = 2 * Math.atan(viewportHeight / 2 / CAMERA_DISTANCE) * (180 / Math.PI);
      camera.updateProjectionMatrix();
      records.forEach((record) => {
        record.uniforms.uViewport.value.set(viewportWidth, viewportHeight);
      });
    }

    if (resizeSimulation) simulation.resize(viewportWidth, viewportHeight);
  }

  function scheduleSimulationResize() {
    if (simulationResizeTimer) window.clearTimeout(simulationResizeTimer);
    simulationResizeTimer = window.setTimeout(() => {
      simulationResizeTimer = 0;
      const viewport = getViewportSize();
      resizeRenderer(viewport.width, viewport.height, true);
      dirty = true;
    }, SIMULATION_RESIZE_SETTLE_DELAY);
  }

  function updateRect(record, force = false, scrollY = window.scrollY) {
    if (record.dynamicLayout) {
      const measuredRect = record.layoutElement.getBoundingClientRect();
      record.lastWidth = measuredRect.width;
      record.lastHeight = measuredRect.height;
      record.documentTop = measuredRect.top + window.scrollY;
      record.documentLeft = measuredRect.left + window.scrollX;
      record.needsMeasure = false;
    } else if (force || record.needsMeasure || !record.lastWidth || !record.lastHeight) {
      const measuredRect = record.layoutElement.getBoundingClientRect();
      record.lastWidth = measuredRect.width;
      record.lastHeight = measuredRect.height;
      record.documentTop = measuredRect.top + window.scrollY;
      record.documentLeft = measuredRect.left + window.scrollX;
      record.needsMeasure = false;
    }

    const rect = record.dynamicLayout
      ? record.layoutElement.getBoundingClientRect()
      : new DOMRect(
          record.documentLeft - window.scrollX,
          record.documentTop - scrollY,
          record.lastWidth,
          record.lastHeight,
        );
    if (
      !force &&
      rect.top === record.lastTop &&
      rect.left === record.lastLeft
    ) {
      return;
    }

    record.imageRect = rect;
    record.lastTop = rect.top;
    record.lastLeft = rect.left;

    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    if (force) resizeRenderer(viewportWidth, viewportHeight);

    const renderWidth = rect.width + record.meshOverscan * 2;
    const renderHeight = rect.height + record.meshOverscan * 2;
    record.mesh.scale.set(renderWidth, renderHeight, 1);
    record.mesh.position.set(
      rect.left + rect.width / 2 - viewportWidth / 2,
      -rect.top - rect.height / 2 + viewportHeight / 2,
      0,
    );

    record.uniforms.uObjectCenter.value.set(
      ((rect.left + rect.width / 2) / viewportWidth) * 2 - 1,
      1 - ((rect.top + rect.height / 2) / viewportHeight) * 2,
    );
    record.uniforms.uImageSize.value.set(Math.max(renderWidth, 1), Math.max(renderHeight, 1));
    record.uniforms.uTextureSize.value.set(
      record.image.naturalWidth || Number(record.image.getAttribute("width")) || 1,
      record.image.naturalHeight || Number(record.image.getAttribute("height")) || 1,
    );
  }

  function activateRecord(record) {
    if (record.activated || record.failed || destroyed) return;
    record.activated = true;
    createOptimizedTexture(record.image)
      .then((texture) => {
        if (destroyed) return;
        record.texture = texture;
        record.uniforms.uTexture.value = texture;
        record.ready = true;
        // Keep the native image as an always-correct fallback underneath the
        // transparent WebGL layer. The shader fully covers it when healthy,
        // while context loss or a failed draw can no longer blank the page.
        record.image.style.opacity = "0";
        record.uniforms.uTextureSize.value.set(
          record.image.naturalWidth || Number(record.image.getAttribute("width")) || 1,
          record.image.naturalHeight || Number(record.image.getAttribute("height")) || 1,
        );
        record.mesh.visible = record.visible;
        canvas.classList.add("is-ready");
        updateCanvasVisibility();
        dirty = true;
      })
      .catch(() => {
        record.failed = true;
        record.mesh.visible = false;
        record.image.style.opacity = "";
      });
  }

  function updateCanvasVisibility() {
    hasInteractiveRecords = records.some(
      (record) => record.visible && record.ready && !record.failed,
    );
    canvas.style.visibility = hasInteractiveRecords ? "visible" : "hidden";
    if (!hasInteractiveRecords) pendingPointerDelta.set(0, 0);
  }

  const resizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const record = recordByElement.get(entry.target);
      if (record) record.needsMeasure = true;
    });
    dirty = true;
    scheduleSimulationResize();
  });
  records.forEach((record) => resizeObserver.observe(record.layoutElement));

  const activationObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const record = recordByElement.get(entry.target);
        if (!record) return;
        activationObserver.unobserve(record.layoutElement);
        activateRecord(record);
      });
    },
    { rootMargin: "320px 0px" },
  );

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const record = recordByElement.get(entry.target);
        if (!record) return;
        record.visible = entry.isIntersecting && entry.intersectionRatio > 0.01;
        record.mesh.visible = record.visible && record.ready;
        if (record.visible) {
          record.needsMeasure = true;
          dirty = true;
        }
        else {
          record.hoverTarget = 0;
          record.hover = 0;
          record.uniforms.uHoverLerp.value = 0;
        }
      });
      updateCanvasVisibility();
    },
    { threshold: [0, 0.01] },
  );
  records.forEach((record) => {
    activationObserver.observe(record.layoutElement);
    visibilityObserver.observe(record.layoutElement);
  });

  const handleResize = () => {
    records.forEach((record) => {
      record.needsMeasure = true;
    });
    dirty = true;
    scheduleSimulationResize();
  };

  const handleLoad = () => {
    records.forEach((record) => {
      record.needsMeasure = true;
    });
    dirty = true;
  };

  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("pointerleave", clearPointerHover, { passive: true });
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("load", handleLoad, { once: true });
  document.fonts?.ready.then(handleLoad).catch(() => {});

  const restoreNativeImages = () => {
    records.forEach((record) => {
      record.image.style.opacity = "";
    });
    canvas.classList.remove("is-ready");
    canvas.style.visibility = "hidden";
  };
  canvas.addEventListener("webglcontextlost", restoreNativeImages, { passive: true });

  const unsubscribe = subscribeVisualFrame((scrollState, time, deltaTime) => {
    const activeRecords = records.filter((record) => record.visible && record.ready && !record.failed);
    if (!activeRecords.length || destroyed) {
      pendingPointerDelta.set(0, 0);
      return;
    }

    // Keep the fixed WebGL surface in lockstep with the CSS viewport. Waiting
    // for resize to settle lets the browser stretch the old drawing buffer,
    // which visibly distorts responsive images while the window is moving.
    const viewport = getViewportSize();
    if (
      viewport.width !== rendererWidth ||
      viewport.height !== rendererHeight ||
      getPixelRatio() !== rendererPixelRatio
    ) {
      resizeRenderer(viewport.width, viewport.height);
      dirty = true;
    }

    if (dirty || scrollState.animatedScroll !== lastScroll) {
      lastScroll = scrollState.animatedScroll;
      activeRecords.forEach((record) => updateRect(record, false, scrollState.animatedScroll));
      dirty = false;
    } else {
      activeRecords.forEach((record) => {
        if (record.dynamicLayout) updateRect(record, false, scrollState.animatedScroll);
      });
    }

    const frameTime = THREE.MathUtils.clamp(deltaTime || 1 / 60, 1 / 120, 0.05);
    const mouseFollow = dampFactor(0.1, frameTime);
    smoothMouseNdc.lerp(targetMouseNdc, mouseFollow);
    activeRecords.forEach((record) => {
      const hoverProgress = THREE.MathUtils.clamp(
        ((time || performance.now()) - record.hoverStartedAt) / 700,
        0,
        1,
      );
      const hoverEase = hoverProgress >= 1 ? 1 : 1 - 2 ** (-10 * hoverProgress);
      record.hover = THREE.MathUtils.lerp(record.hoverStart, record.hoverTarget, hoverEase);
      record.uniforms.uFluidVelocity.value = simulation.texture;
      record.uniforms.uMouseL.value.copy(smoothMouseNdc);
      record.uniforms.uHoverLerp.value = record.hover;
    });

    // The reference scene feeds the viewport-wide NDC mouse delta into one
    // shared velocity texture. Hover only controls the image parallax tween;
    // it never gates or abruptly clears the fluid field.
    exactPointerDelta.copy(pendingPointerDelta).multiplyScalar(2);
    simulation.update(targetMouseNdc, exactPointerDelta);
    pendingPointerDelta.set(0, 0);

    activeRecords.forEach((record) => {
      record.uniforms.uFluidVelocity.value = simulation.texture;
    });

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
  });

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    resizeObserver.disconnect();
    activationObserver.disconnect();
    visibilityObserver.disconnect();
    if (simulationResizeTimer) window.clearTimeout(simulationResizeTimer);
    window.removeEventListener("pointermove", updatePointer);
    window.removeEventListener("pointerleave", clearPointerHover);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("load", handleLoad);
    window.removeEventListener("pagehide", handlePageHide);
    canvas.removeEventListener("webglcontextlost", restoreNativeImages);
    geometry.dispose();
    records.forEach((record) => {
      record.texture?.dispose();
      record.material.dispose();
      record.image.style.opacity = "";
    });
    simulation.dispose();
    renderer.dispose();
    canvas.remove();
  }

  resizeRenderer(initialViewport.width, initialViewport.height, true);
  records.forEach((record) => updateRect(record, true));
  const handlePageHide = (event) => {
    if (!event.persisted) cleanup();
  };
  window.addEventListener("pagehide", handlePageHide);
}

function isPointInsideRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function dampFactor(baseFactor, deltaTime, referenceFps = 60) {
  return 1 - Math.pow(1 - baseFactor, deltaTime * referenceFps);
}

function getPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

function getViewportSize() {
  const root = document.documentElement;
  return {
    width: Math.max(root.clientWidth || window.innerWidth, 1),
    height: Math.max(root.clientHeight || window.innerHeight, 1),
  };
}

async function createOptimizedTexture(image) {
  if (!image.complete || !image.naturalWidth) {
    await image.decode();
  }

  const sourceWidth = Math.max(image.naturalWidth, 1);
  const sourceHeight = Math.max(image.naturalHeight, 1);
  const textureWidth = Math.min(sourceWidth, MAX_TEXTURE_WIDTH);
  const textureHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * textureWidth));
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = textureWidth;
  textureCanvas.height = textureHeight;
  const context = textureCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Unable to create ripple texture context");
  context.drawImage(image, 0, 0, textureWidth, textureHeight);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

const imageVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const imageFragmentShader = `
  precision highp float;

  uniform sampler2D uTexture;
  uniform sampler2D uFluidVelocity;
  uniform vec2 uMouseL;
  uniform vec2 uObjectCenter;
  uniform float uHoverLerp;
  uniform float uBaseScale;
  uniform float uHoverScale;
  uniform vec2 uMediaOffset;
  uniform float uFluidStrength;
  uniform float uEnableRgb;
  uniform float uEnableHoverParallax;
  uniform float uObjectPositionY;
  uniform vec2 uImageSize;
  uniform vec2 uTextureSize;
  uniform vec2 uViewport;
  uniform float uCornerRadius;

  varying vec2 vUv;

  vec2 coverUv(vec2 uv) {
    float imageRatio = uTextureSize.x / max(uTextureSize.y, 1.0);
    float containerRatio = uImageSize.x / max(uImageSize.y, 1.0);
    float coverRatio = imageRatio / containerRatio;
    if (coverRatio > 1.0) {
      uv.x = 0.5 + (uv.x - 0.5) / coverRatio;
    } else {
      uv.y = uv.y * coverRatio + (1.0 - coverRatio) * uObjectPositionY;
    }
    return uv;
  }

  float roundedMask(vec2 uv) {
    vec2 pixelPosition = uv * uImageSize;
    vec2 halfSize = uImageSize * 0.5;
    vec2 distanceFromCenter = abs(pixelPosition - halfSize);
    vec2 innerBounds = max(halfSize - vec2(uCornerRadius), vec2(0.0));
    float distanceToEdge = length(max(distanceFromCenter - innerBounds, 0.0)) - uCornerRadius;
    return 1.0 - smoothstep(-1.0, 1.0, distanceToEdge);
  }

  vec4 sampleMedia(vec2 uv, vec2 sampleOffset) {
    vec4 center = texture2D(uTexture, uv);
    if (uEnableRgb < 0.5) return center;

    vec3 rgb = vec3(
      texture2D(uTexture, uv - sampleOffset).r,
      center.g,
      texture2D(uTexture, uv + sampleOffset).b
    );
    return vec4(rgb, center.a);
  }

  void main() {
    float mask = roundedMask(vUv);
    if (mask < 0.01) discard;

    float containerRatio = uImageSize.x / max(uImageSize.y, 1.0);
    float imageRatio = uTextureSize.x / max(uTextureSize.y, 1.0);
    float coverRatio = imageRatio / containerRatio;
    vec2 mediaUv = vUv;

    vec2 parallaxOffset = vec2(
      (uObjectCenter.x - uMouseL.x) * 0.04,
      (uObjectCenter.y - uMouseL.y) * 0.06
    ) * uHoverLerp * uEnableHoverParallax;
    float parallaxScale = uBaseScale + uHoverScale * uHoverLerp;
    mediaUv = (mediaUv - 0.5) / parallaxScale + 0.5;

    float parallaxScaleX = coverRatio > 1.0 ? 1.0 / coverRatio : 1.0;
    float parallaxScaleY = coverRatio > 1.0 ? 1.0 : coverRatio;
    mediaUv.x += parallaxOffset.x * parallaxScaleX;
    mediaUv.y += parallaxOffset.y * parallaxScaleY;
    mediaUv = coverUv(mediaUv);
    mediaUv += uMediaOffset;

    vec2 screenUv = gl_FragCoord.xy / max(uViewport, vec2(1.0));
    vec2 fluidVelocity = texture2D(uFluidVelocity, screenUv).rg;
    fluidVelocity.x /= max(containerRatio, 1.0);
    fluidVelocity.y /= max(containerRatio, 1.0);
    mediaUv -= fluidVelocity * uFluidStrength;

    vec2 sampleOffset = fluidVelocity * uFluidStrength * 0.2;
    vec4 color = sampleMedia(mediaUv, sampleOffset);
    gl_FragColor = vec4(color.rgb, color.a * mask);
  }
`;
