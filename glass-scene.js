import * as THREE from "./assets/vendor/three.module.js";
import { GLTFLoader } from "./assets/vendor/GLTFLoader.js";
import { RGBELoader } from "./assets/vendor/RGBELoader.js";
import { MeshTransmissionMaterial } from "./assets/vendor/MeshTransmissionMaterial.js";
import { subscribeVisualFrame } from "./scroll-system.js?v=target-scroll-4";

const MODEL_URL = "./assets/work-glass-star.glb";
const ENVIRONMENT_URL = "./assets/forest_slope_1k.hdr";
const CAMERA_FOV = 75;
const CAMERA_DISTANCE = 5;
const BUFFER_SIZE = 512;
const POINTER_DAMPING = 0.2;
const MODEL_Z = 1.3;
const INTERNAL_TEXT_Z = -2.5;
const INTERNAL_TEXT_LINES = [
  "GOOD LOOKS",
  "MUST FOLLOW",
  "GOOD FUNCTION",
];

export function initGlassCurtainScene(canvas) {
  const veil = canvas.closest(".work-veil");
  const section = canvas.closest(".work-interlude");
  if (!veil || !section || !THREE.WebGLRenderer) {
    veil?.classList.add("is-fallback");
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    veil.classList.add("is-fallback");
    return;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  // These are the reference Canvas scene's original light values.
  const directionalLight = new THREE.DirectionalLight(0xffffff, 5);
  directionalLight.position.set(0, 3, 2);
  scene.add(directionalLight);

  const group = new THREE.Group();
  scene.add(group);

  const backdropGeometry = new THREE.PlaneGeometry(1, 1);
  const backdropMaterial = new THREE.MeshBasicMaterial({
    color: 0x484848,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
  backdrop.position.z = -2.5;
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  const renderTarget = new THREE.WebGLRenderTarget(BUFFER_SIZE, BUFFER_SIZE, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const transmissionMaterial = new MeshTransmissionMaterial(4, false);
  transmissionMaterial._transmission = 1;
  transmissionMaterial.transmission = 0;
  transmissionMaterial.roughness = 0;
  transmissionMaterial.thickness = 3.5;
  transmissionMaterial.ior = 1.5;
  transmissionMaterial.chromaticAberration = 1;
  transmissionMaterial.anisotropicBlur = 0.1;
  transmissionMaterial.distortion = 0;
  transmissionMaterial.distortionScale = 0;
  transmissionMaterial.temporalDistortion = 0.5;
  transmissionMaterial.clearcoat = 1;
  transmissionMaterial.attenuationDistance = 0.5;
  transmissionMaterial.attenuationColor = new THREE.Color("#ffffff");
  transmissionMaterial.color.set("#ffffff");
  transmissionMaterial.buffer = renderTarget.texture;
  transmissionMaterial.side = THREE.FrontSide;

  let star = null;
  let internalText = null;
  let sourceTexture = null;
  let environmentTexture = null;
  let environmentTarget = null;
  let destroyed = false;
  let ready = false;
  let inViewport = false;
  let pointerX = 0;
  let pointerY = 0;
  let easedX = 0;
  let easedY = 0;
  let width = 1;
  let height = 1;
  let sectionDocumentTop = section.getBoundingClientRect().top + window.scrollY;
  let resizeFrame = 0;

  const handleFailure = () => {
    if (destroyed) return;
    veil.classList.remove("is-ready");
    veil.classList.add("is-fallback");
  };

  const texturePromise = loadTexture(canvas.dataset.texture || "assets/work-sunset.webp")
    .then((texture) => {
      if (destroyed) {
        texture.dispose();
        return;
      }
      sourceTexture = texture;
      backdropMaterial.map = texture;
      backdropMaterial.needsUpdate = true;
      updateBackdropCover();
    });

  const modelPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (destroyed) return;
        let sourceMesh = null;
        gltf.scene.traverse((child) => {
          if (!sourceMesh && child.isMesh && child.geometry) sourceMesh = child;
        });
        if (!sourceMesh) {
          reject(new Error("The reference glass model does not contain a mesh."));
          return;
        }

        star = new THREE.Mesh(sourceMesh.geometry, transmissionMaterial);
        star.rotation.x = Math.PI / 2;
        star.position.z = MODEL_Z;
        group.add(star);
        resolve();
      },
      undefined,
      reject,
    );
  });

  const textPromise = loadInternalTextLayer(section)
    .then((textLayer) => {
      if (destroyed) {
        disposeTextLayer(textLayer);
        return;
      }
      internalText = textLayer;
      group.add(textLayer);
    });

  const environmentPromise = new Promise((resolve, reject) => {
    new RGBELoader().load(
      ENVIRONMENT_URL,
      (texture) => {
        if (destroyed) {
          texture.dispose();
          resolve();
          return;
        }
        environmentTexture = texture;
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        environmentTarget = pmremGenerator.fromEquirectangular(texture);
        scene.environment = environmentTarget.texture;
        pmremGenerator.dispose();
        resolve();
      },
      undefined,
      reject,
    );
  });

  Promise.all([texturePromise, modelPromise, environmentPromise, textPromise])
    .then(() => {
      if (destroyed) return;
      resize();
      render(performance.now());
      ready = true;
      veil.classList.add("is-ready");
      veil.classList.remove("is-fallback");
    })
    .catch(handleFailure);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    sectionDocumentTop = section.getBoundingClientRect().top + window.scrollY;
    width = Math.max(1, rect.width || window.innerWidth);
    height = Math.max(1, rect.height || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const viewportHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * CAMERA_DISTANCE;
    const viewportWidth = viewportHeight * camera.aspect;
    group.scale.setScalar(viewportWidth / 6);
    updateInternalTextLayout();
    updateBackdropCover();
  }

  function updateInternalTextLayout() {
    if (!internalText) return;
    const canvasRect = canvas.getBoundingClientRect();
    const textSpans = section.querySelectorAll(".work-interlude-type span");
    const groupScale = group.scale.x || 1;
    const textWorldZ = INTERNAL_TEXT_Z * groupScale;
    const textDistance = camera.position.z - textWorldZ;
    const textViewportHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * textDistance;
    const textViewportWidth = textViewportHeight * camera.aspect;
    const worldPerPixelX = textViewportWidth / width;
    const worldPerPixelY = textViewportHeight / height;

    internalText.children.forEach((line, index) => {
      const span = textSpans[index];
      if (!span) return;
      const spanRect = span.getBoundingClientRect();
      const textureSignature = getTextTextureSignature(span);
      if (line.userData.textureSignature !== textureSignature) {
        const previousTexture = line.material.map;
        const texture = createTextTexture(INTERNAL_TEXT_LINES[index], span);
        line.material.map = texture;
        line.material.needsUpdate = true;
        line.userData.textureSignature = textureSignature;
        previousTexture?.dispose();
      }

      const textLayout = line.material.map?.userData?.textLayout;
      const paddedWidth = textLayout?.width || spanRect.width;
      const paddedHeight = textLayout?.height || spanRect.height;
      const centerX = spanRect.left + spanRect.width / 2 - canvasRect.left;
      const centerY = spanRect.top + spanRect.height / 2 - canvasRect.top;
      const localWidth = paddedWidth * worldPerPixelX / groupScale;
      const localHeight = paddedHeight * worldPerPixelY / groupScale;

      line.position.set(
        (centerX - width / 2) * worldPerPixelX / groupScale,
        (height / 2 - centerY) * worldPerPixelY / groupScale,
        INTERNAL_TEXT_Z,
      );
      line.scale.set(localWidth, localHeight, 1);
    });
  }

  function updateBackdropCover() {
    if (!sourceTexture) return;
    const distance = camera.position.z - backdrop.position.z;
    const planeHeight = 2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * distance;
    const planeWidth = planeHeight * camera.aspect;
    backdrop.scale.set(planeWidth, planeHeight, 1);

    const imageWidth = sourceTexture.image?.naturalWidth || sourceTexture.image?.width || 1;
    const imageHeight = sourceTexture.image?.naturalHeight || sourceTexture.image?.height || 1;
    const imageAspect = imageWidth / imageHeight;
    const viewportAspect = width / height;
    sourceTexture.repeat.set(1, 1);
    sourceTexture.offset.set(0, 0);
    if (imageAspect > viewportAspect) {
      const repeatX = viewportAspect / imageAspect;
      sourceTexture.repeat.x = repeatX;
      sourceTexture.offset.x = (1 - repeatX) / 2;
    } else {
      const repeatY = imageAspect / viewportAspect;
      sourceTexture.repeat.y = repeatY;
      sourceTexture.offset.y = (1 - repeatY) / 2;
    }
    sourceTexture.needsUpdate = true;
  }

  function queueResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
      if (ready && inViewport) render(performance.now());
    });
  }

  const resizeObserver = new ResizeObserver(queueResize);
  resizeObserver.observe(veil);
  resize();

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      inViewport = entry.isIntersecting && entry.intersectionRatio > 0.01;
    },
    { threshold: [0, 0.01] },
  );
  intersectionObserver.observe(section);

  const updatePointer = (event) => {
    pointerX = event.clientX / Math.max(window.innerWidth, 1) * 2 - 1;
    pointerY = -(event.clientY / Math.max(window.innerHeight, 1) * 2 - 1);
  };
  window.addEventListener("pointermove", updatePointer, { passive: true });

  const unsubscribe = subscribeVisualFrame((_scrollState, time) => {
    if (!ready || !inViewport || document.hidden || destroyed || !star) return;

    // These are the reference component's original input equations.
    easedX += POINTER_DAMPING * (pointerX - easedX);
    easedY += POINTER_DAMPING * (pointerY - easedY);
    const rectTop = sectionDocumentTop - window.scrollY;
    const scrollRotation = rectTop / Math.max(window.innerWidth / 2, 1);

    star.rotation.y = scrollRotation;
    star.rotation.z = easedX / 2.5;
    star.rotation.x = Math.PI / 2 + easedY / 2.5;
    star.position.x = easedX / (5 / 1.5);
    star.position.y = easedY / 5;
    star.position.z = MODEL_Z;

    render(time);
  });

  function render(time = 0) {
    if (!star || !sourceTexture || destroyed) return;

    transmissionMaterial.time = time * 0.001;
    const previousToneMapping = renderer.toneMapping;

    try {
      renderer.toneMapping = THREE.NoToneMapping;
      star.visible = false;
      backdrop.visible = true;
      internalText.visible = true;
      renderer.setRenderTarget(renderTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      star.visible = true;
      backdrop.visible = false;
      internalText.visible = false;
      transmissionMaterial.buffer = renderTarget.texture;
      renderer.setRenderTarget(null);
      renderer.toneMapping = previousToneMapping;
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    } catch {
      renderer.setRenderTarget(null);
      renderer.toneMapping = previousToneMapping;
      star.visible = true;
      backdrop.visible = false;
      if (internalText) internalText.visible = false;
      handleFailure();
    }
  }

  const handleContextLost = (event) => {
    event.preventDefault();
    handleFailure();
  };
  canvas.addEventListener("webglcontextlost", handleContextLost, false);

  const handlePageHide = (event) => {
    if (!event.persisted) cleanup();
  };
  window.addEventListener("pagehide", handlePageHide);

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    window.removeEventListener("pointermove", updatePointer);
    window.removeEventListener("pagehide", handlePageHide);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    sourceTexture?.dispose();
    environmentTexture?.dispose();
    environmentTarget?.dispose();
    renderTarget.dispose();
    star?.geometry.dispose();
    if (internalText) disposeTextLayer(internalText);
    backdropGeometry.dispose();
    backdropMaterial.dispose();
    transmissionMaterial.dispose();
    renderer.dispose();
  }
}

async function loadInternalTextLayer(section) {
  if (document.fonts?.load) {
    await document.fonts.load('700 96px "Cinzel"');
  }

  const textLayer = new THREE.Group();
  textLayer.name = "refracted-internal-type";
  const textSpans = section.querySelectorAll(".work-interlude-type span");

  INTERNAL_TEXT_LINES.forEach((text, index) => {
    const referenceElement = textSpans[index];
    const texture = createTextTexture(text, referenceElement);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.01,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const line = new THREE.Mesh(geometry, material);
    line.position.set(0, 0, INTERNAL_TEXT_Z);
    line.renderOrder = 0;
    line.userData.textureSignature = getTextTextureSignature(referenceElement);
    textLayer.add(line);
  });

  return textLayer;
}

function createTextTexture(text, referenceElement) {
  const computed = referenceElement ? getComputedStyle(referenceElement) : null;
  const cssFontSize = Number.parseFloat(computed?.fontSize) || 144;
  const cssLineHeight = Number.parseFloat(computed?.lineHeight) || cssFontSize * 0.9;
  const cssWidth = referenceElement?.getBoundingClientRect().width || cssFontSize * text.length * 0.72;
  const fontWeight = computed?.fontWeight || "700";
  const fontFamily = computed?.fontFamily || '"Cinzel", Georgia, serif';
  const resolutionScale = 3;
  const logicalPadding = cssFontSize * 0.24;
  const logicalWidth = cssWidth + logicalPadding * 2;
  const logicalHeight = cssLineHeight + logicalPadding * 2;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = Math.min(4096, Math.max(2, Math.ceil(logicalWidth * resolutionScale)));
  canvas.height = Math.min(2048, Math.max(2, Math.ceil(logicalHeight * resolutionScale)));

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(resolutionScale, resolutionScale);
  context.font = `${fontWeight} ${cssFontSize}px ${fontFamily}`;
  const metrics = context.measureText(text);
  const fontAscent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || cssFontSize * 0.78;
  const fontDescent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || cssFontSize * 0.22;
  const lineLeading = cssLineHeight - fontAscent - fontDescent;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#ffffff";
  context.fillText(
    text,
    logicalPadding + cssWidth / 2,
    logicalPadding + lineLeading / 2 + fontAscent,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.userData.textLayout = {
    width: logicalWidth,
    height: logicalHeight,
  };
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function getTextTextureSignature(referenceElement) {
  if (!referenceElement) return "fallback";
  const computed = getComputedStyle(referenceElement);
  const rect = referenceElement.getBoundingClientRect();
  return [
    rect.width.toFixed(2),
    computed.fontSize,
    computed.lineHeight,
    computed.fontWeight,
    computed.fontFamily,
  ].join("|");
}

function disposeTextLayer(textLayer) {
  textLayer.traverse((child) => {
    if (!child.isMesh) return;
    child.material?.map?.dispose();
    child.material?.dispose();
    child.geometry?.dispose();
  });
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}
