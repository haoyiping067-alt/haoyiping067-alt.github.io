import * as THREE from "./assets/vendor/three.module.js";
import { subscribeVisualFrame } from "./scroll-system.js?v=target-scroll-4";

THREE.ColorManagement.enabled = false;

const CAMERA_DISTANCE = 800;
const MAX_PIXEL_RATIO = 1;
const SIMULATION_RESOLUTION = 0.25;
const FIXED_DELTA_TIME = 0.016;
const MOUSE_FORCE = 120;
const CURSOR_SIZE = 40;
const VISCOSITY = 4;
const VISCOSITY_ITERATIONS = 8;
const PRESSURE_ITERATIONS = 16;
const FLUID_STRENGTH = 0.5;
const MAX_TEXTURE_WIDTH = 1600;

export function initTargetHoverRipple(image) {
  if (!(image instanceof HTMLImageElement) || !THREE.WebGLRenderer || getViewport().width <= 1024) {
    return null;
  }

  // The reference implementation measures the image itself. Measuring the
  // surrounding figure also includes its caption and shifts/scales the mesh.
  const frame = image;
  const canvas = document.createElement("canvas");
  canvas.className = "target-hover-ripple-canvas";
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
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
  camera.position.z = CAMERA_DISTANCE;
  const geometry = new THREE.PlaneGeometry(1, 1, 16, 16);
  const simulation = new TargetFluidSimulation(renderer);
  const targetMouse = new THREE.Vector2(0, 0);
  const currentMouse = new THREE.Vector2(0, 0);
  const previousPointer = new THREE.Vector2(0, 0);
  const simulationPreviousMouse = new THREE.Vector2(0, 0);
  const simulationMouseDiff = new THREE.Vector2(0, 0);
  let targetScalarSpeed = 0;
  let currentScalarSpeed = 0;
  let pointerMovedThisFrame = false;
  let pointerInitialized = false;
  let hoverTarget = 0;
  let hover = 0;
  let transColor = 0;
  let colorTweenStart = 0;
  let colorTweenEnd = 0;
  let colorTweenStartedAt = 0;
  let colorTweenEntering = false;
  let visible = false;
  let destroyed = false;
  let dirty = true;
  let texture = null;
  let ready = false;
  let frameTop = 0;
  let frameLeft = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  let lastScroll = Number.NaN;
  let rendererWidth = 0;
  let rendererHeight = 0;
  let simulationResizeTimer = 0;

  const uniforms = {
    uTexture: { value: null },
    uFluidVelocity: { value: simulation.texture },
    uMouseL: { value: currentMouse },
    uLSpeed: { value: 0 },
    uHoverLerp: { value: 0 },
    uTransColor: { value: 0 },
    uFluidStrength: { value: FLUID_STRENGTH },
    uImageSize: { value: new THREE.Vector2(1, 1) },
    uTextureSize: { value: new THREE.Vector2(1, 1) },
    uViewport: { value: new THREE.Vector2(1, 1) },
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

  function resizeRenderer(resizeSimulation = false) {
    const viewport = getViewport();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (
      viewport.width !== rendererWidth ||
      viewport.height !== rendererHeight ||
      renderer.getPixelRatio() !== pixelRatio
    ) {
      rendererWidth = viewport.width;
      rendererHeight = viewport.height;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(viewport.width, viewport.height, false);
      camera.aspect = viewport.width / viewport.height;
      camera.fov = 2 * Math.atan(viewport.height / 2 / CAMERA_DISTANCE) * (180 / Math.PI);
      camera.updateProjectionMatrix();
      uniforms.uViewport.value.set(viewport.width, viewport.height);
      dirty = true;
    }
    if (resizeSimulation) simulation.resize(viewport.width, viewport.height);
  }

  function measure() {
    const rect = frame.getBoundingClientRect();
    frameTop = rect.top;
    frameLeft = rect.left;
    frameWidth = rect.width;
    frameHeight = rect.height;
    dirty = true;
  }

  function positionMesh() {
    const viewport = getViewport();
    mesh.scale.set(frameWidth, frameHeight, 1);
    mesh.position.set(
      frameLeft + frameWidth / 2 - viewport.width / 2,
      -frameTop - frameHeight / 2 + viewport.height / 2,
      0,
    );
    uniforms.uImageSize.value.set(Math.max(frameWidth, 1), Math.max(frameHeight, 1));
  }

  function updatePointer(event) {
    const viewport = getViewport();
    const nextX = (event.clientX / viewport.width) * 2 - 1;
    const nextY = 1 - (event.clientY / viewport.height) * 2;
    targetMouse.set(nextX, nextY);
    if (!pointerInitialized) {
      previousPointer.copy(targetMouse);
      currentMouse.copy(targetMouse);
      simulationPreviousMouse.copy(targetMouse);
      pointerInitialized = true;
    }
    const speedX = previousPointer.x - nextX;
    const speedY = previousPointer.y - nextY;
    targetScalarSpeed = Math.hypot(speedX, speedY);
    previousPointer.copy(targetMouse);
    pointerMovedThisFrame = true;
  }

  function enter() {
    hoverTarget = 1;
    startColorTween(1, true);
  }

  function leave() {
    hoverTarget = 0;
    startColorTween(0, false);
  }

  function startColorTween(value, entering) {
    colorTweenStart = transColor;
    colorTweenEnd = value;
    colorTweenStartedAt = performance.now();
    colorTweenEntering = entering;
  }

  function scheduleSimulationResize() {
    window.clearTimeout(simulationResizeTimer);
    simulationResizeTimer = window.setTimeout(() => {
      const viewport = getViewport();
      simulation.resize(viewport.width, viewport.height);
      simulationResizeTimer = 0;
    }, 120);
  }

  const resizeObserver = new ResizeObserver(() => {
    measure();
    resizeRenderer();
    scheduleSimulationResize();
  });
  resizeObserver.observe(frame);

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.01);
      mesh.visible = visible && ready;
      canvas.style.visibility = visible && ready ? "visible" : "hidden";
      if (visible) measure();
      else leave();
    },
    { threshold: [0, 0.01] },
  );
  visibilityObserver.observe(frame);

  window.addEventListener("pointermove", updatePointer, { passive: true });
  frame.addEventListener("pointerenter", enter, { passive: true });
  frame.addEventListener("pointerleave", leave, { passive: true });
  window.addEventListener("resize", scheduleSimulationResize, { passive: true });

  createTexture(image)
    .then((nextTexture) => {
      if (destroyed) {
        nextTexture.dispose();
        return;
      }
      texture = nextTexture;
      uniforms.uTexture.value = texture;
      uniforms.uTextureSize.value.set(
        image.naturalWidth || Number(image.getAttribute("width")) || 1,
        image.naturalHeight || Number(image.getAttribute("height")) || 1,
      );
      ready = true;
      mesh.visible = visible;
      canvas.classList.add("is-ready");
      canvas.style.visibility = visible ? "visible" : "hidden";
      // Keep the native image in layout, but let the WebGL plane be the only
      // visible copy once its texture is ready.
      image.style.opacity = "0";
      measure();
    })
    .catch(() => {
      image.style.opacity = "";
      mesh.visible = false;
    });

  const unsubscribe = subscribeVisualFrame((scrollState, time, deltaTime) => {
    if (!visible || !ready || destroyed) return;
    resizeRenderer();
    if (dirty || scrollState.animatedScroll !== lastScroll) {
      lastScroll = scrollState.animatedScroll;
      measure();
      positionMesh();
      dirty = false;
    }

    const frameSeconds = THREE.MathUtils.clamp(deltaTime || 1 / 60, 1 / 120, 0.05);
    currentMouse.lerp(targetMouse, dampFactor(0.1, frameSeconds));
    currentScalarSpeed +=
      (targetScalarSpeed - currentScalarSpeed) * dampFactor(0.05, frameSeconds);
    hover += (hoverTarget - hover) * dampFactor(0.1, frameSeconds, 30);
    const colorProgress = THREE.MathUtils.clamp(
      (performance.now() - colorTweenStartedAt) / 100,
      0,
      1,
    );
    const colorEase = colorTweenEntering
      ? colorProgress * colorProgress
      : 1 - (1 - colorProgress) * (1 - colorProgress);
    transColor = THREE.MathUtils.lerp(colorTweenStart, colorTweenEnd, colorEase);

    simulationMouseDiff.subVectors(targetMouse, simulationPreviousMouse);
    simulationPreviousMouse.copy(targetMouse);
    simulation.update(targetMouse, simulationMouseDiff);
    uniforms.uFluidVelocity.value = simulation.texture;
    uniforms.uHoverLerp.value = hover;
    uniforms.uTransColor.value = transColor;
    uniforms.uLSpeed.value = currentScalarSpeed;
    if (!pointerMovedThisFrame) targetScalarSpeed = 0;
    pointerMovedThisFrame = false;

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
  });

  function restoreNativeImage() {
    image.style.opacity = "";
    canvas.classList.remove("is-ready");
    canvas.style.visibility = "hidden";
  }
  canvas.addEventListener("webglcontextlost", restoreNativeImage, { passive: true });

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    window.clearTimeout(simulationResizeTimer);
    window.removeEventListener("pointermove", updatePointer);
    window.removeEventListener("resize", scheduleSimulationResize);
    frame.removeEventListener("pointerenter", enter);
    frame.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("webglcontextlost", restoreNativeImage);
    texture?.dispose();
    geometry.dispose();
    material.dispose();
    simulation.dispose();
    renderer.dispose();
    canvas.remove();
    image.style.opacity = "";
  }

  resizeRenderer(true);
  measure();
  positionMesh();
  const handlePageHide = (event) => {
    if (!event.persisted) cleanup();
  };
  window.addEventListener("pagehide", handlePageHide, { once: true });
  return cleanup;
}

export class TargetFluidSimulation {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.geometry, null);
    this.forceGeometry = new THREE.PlaneGeometry(1, 1);
    this.forceMesh = new THREE.Mesh(this.forceGeometry, null);
    this.forceMesh.visible = false;
    this.scene.add(this.quad);
    this.scene.add(this.forceMesh);
    this.width = 1;
    this.height = 1;
    this.cellScale = new THREE.Vector2(1, 1);
    this.boundarySpace = new THREE.Vector2(1, 1);
    this.velocity = null;
    this.advected = null;
    this.viscousA = null;
    this.viscousB = null;
    this.divergence = null;
    this.pressureA = null;
    this.pressureB = null;
    this.materials = {
      advection: makePass(advectionFragment, {
        boundarySpace: this.cellScale,
        px: this.cellScale,
        velocity: null,
        dt: FIXED_DELTA_TIME,
        isBFECC: false,
        fboSize: new THREE.Vector2(1, 1),
      }),
      force: makeForcePass({
        center: new THREE.Vector2(0, 0),
        force: new THREE.Vector2(0, 0),
        px: this.cellScale,
        scale: new THREE.Vector2(CURSOR_SIZE, CURSOR_SIZE),
      }),
      viscosity: makePass(viscosityFragment, {
        boundarySpace: this.boundarySpace,
        velocity: null,
        velocity_new: null,
        v: VISCOSITY,
        px: this.cellScale,
        dt: FIXED_DELTA_TIME,
      }),
      divergence: makePass(divergenceFragment, {
        boundarySpace: this.boundarySpace,
        velocity: null,
        px: this.cellScale,
        dt: 8 * FIXED_DELTA_TIME,
      }),
      pressure: makePass(pressureFragment, {
        boundarySpace: this.boundarySpace,
        pressure: null,
        divergence: null,
        px: this.cellScale,
      }),
      project: makePass(projectFragment, {
        boundarySpace: this.boundarySpace,
        pressure: null,
        velocity: null,
        px: this.cellScale,
        dt: FIXED_DELTA_TIME,
      }),
    };
  }

  get texture() {
    return this.velocity?.texture || null;
  }

  resize(viewportWidth, viewportHeight) {
    const width = Math.max(1, Math.round(viewportWidth * SIMULATION_RESOLUTION));
    const height = Math.max(1, Math.round(viewportHeight * SIMULATION_RESOLUTION));
    if (width === this.width && height === this.height && this.velocity) return;
    this.disposeTargets();
    this.width = width;
    this.height = height;
    this.cellScale.set(1 / width, 1 / height);
    this.boundarySpace.copy(this.cellScale);
    this.materials.advection.uniforms.fboSize.value.set(width, height);
    this.velocity = createFluidTarget(width, height);
    this.advected = createFluidTarget(width, height);
    this.viscousA = createFluidTarget(width, height);
    this.viscousB = createFluidTarget(width, height);
    this.divergence = createFluidTarget(width, height);
    this.pressureA = createFluidTarget(width, height);
    this.pressureB = createFluidTarget(width, height);
    [
      this.velocity,
      this.advected,
      this.viscousA,
      this.viscousB,
      this.divergence,
      this.pressureA,
      this.pressureB,
    ].forEach((target) => clearTarget(this.renderer, target));
  }

  render(material, target) {
    this.forceMesh.visible = false;
    this.quad.visible = true;
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  renderForce(target) {
    this.quad.visible = false;
    this.forceMesh.visible = true;
    this.forceMesh.material = this.materials.force;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  update(mouse, speed) {
    if (!this.velocity) return;

    this.materials.advection.uniforms.velocity.value = this.velocity.texture;
    this.render(this.materials.advection, this.advected);

    const radiusX = CURSOR_SIZE * this.cellScale.x;
    const radiusY = CURSOR_SIZE * this.cellScale.y;
    const centerX = THREE.MathUtils.clamp(mouse.x, -1 + radiusX + 2 * this.cellScale.x, 1 - radiusX - 2 * this.cellScale.x);
    const centerY = THREE.MathUtils.clamp(mouse.y, -1 + radiusY + 2 * this.cellScale.y, 1 - radiusY - 2 * this.cellScale.y);
    this.materials.force.uniforms.center.value.set(centerX, centerY);
    this.materials.force.uniforms.force.value.set(
      (speed.x / 7) * MOUSE_FORCE,
      (speed.y / 7) * MOUSE_FORCE,
    );
    this.materials.force.uniforms.scale.value.set(CURSOR_SIZE, CURSOR_SIZE);
    this.renderForce(this.advected);

    let viscousRead = this.viscousA;
    let viscousWrite = this.viscousB;
    this.materials.viscosity.uniforms.velocity.value = this.advected.texture;
    for (let index = 0; index < VISCOSITY_ITERATIONS; index += 1) {
      this.materials.viscosity.uniforms.velocity_new.value = viscousRead.texture;
      this.render(this.materials.viscosity, viscousWrite);
      [viscousRead, viscousWrite] = [viscousWrite, viscousRead];
    }

    this.materials.divergence.uniforms.velocity.value = viscousRead.texture;
    this.render(this.materials.divergence, this.divergence);

    let pressureRead = this.pressureA;
    let pressureWrite = this.pressureB;
    this.materials.pressure.uniforms.divergence.value = this.divergence.texture;
    for (let index = 0; index < PRESSURE_ITERATIONS; index += 1) {
      this.materials.pressure.uniforms.pressure.value = pressureRead.texture;
      this.render(this.materials.pressure, pressureWrite);
      [pressureRead, pressureWrite] = [pressureWrite, pressureRead];
    }

    this.materials.project.uniforms.pressure.value = pressureRead.texture;
    this.materials.project.uniforms.velocity.value = viscousRead.texture;
    this.render(this.materials.project, this.velocity);
  }

  disposeTargets() {
    [
      this.velocity,
      this.advected,
      this.viscousA,
      this.viscousB,
      this.divergence,
      this.pressureA,
      this.pressureB,
    ].forEach((target) => target?.dispose());
  }

  dispose() {
    this.disposeTargets();
    this.geometry.dispose();
    this.forceGeometry.dispose();
    Object.values(this.materials).forEach((material) => material.dispose());
  }
}

function makePass(fragmentShader, values) {
  const uniforms = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
  return new THREE.RawShaderMaterial({
    uniforms,
    vertexShader: passVertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

function makeForcePass(values) {
  const uniforms = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
  return new THREE.RawShaderMaterial({
    uniforms,
    vertexShader: forceVertexShader,
    fragmentShader: forceFragment,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
}

function createFluidTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

function clearTarget(renderer, target) {
  const previousTarget = renderer.getRenderTarget();
  const previousColor = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousColor, previousAlpha);
}

async function createTexture(image) {
  if (!image.complete || !image.naturalWidth) await image.decode();
  const sourceWidth = Math.max(image.naturalWidth, 1);
  const sourceHeight = Math.max(image.naturalHeight, 1);
  const width = Math.min(sourceWidth, MAX_TEXTURE_WIDTH);
  const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = width;
  textureCanvas.height = height;
  const context = textureCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Unable to create ripple texture");
  context.drawImage(image, 0, 0, width, height);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function getViewport() {
  return {
    width: Math.max(document.documentElement.clientWidth || window.innerWidth, 1),
    height: Math.max(document.documentElement.clientHeight || window.innerHeight, 1),
  };
}

function dampFactor(baseFactor, deltaTime, referenceFps = 60) {
  return 1 - Math.pow(1 - baseFactor, deltaTime * referenceFps);
}

const passVertexShader = `
  attribute vec3 position;
  uniform vec2 px;
  uniform vec2 boundarySpace;
  varying vec2 uv;
  precision highp float;
  void main() {
    vec3 pos = position;
    vec2 scale = 1.0 - boundarySpace * 2.0;
    pos.xy = pos.xy * scale;
    uv = vec2(0.5) + pos.xy * 0.5;
    gl_Position = vec4(pos, 1.0);
  }
`;

const forceVertexShader = `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  uniform vec2 center;
  uniform vec2 scale;
  uniform vec2 px;
  varying vec2 vUv;
  void main() {
    vec2 pos = position.xy * scale * 2.0 * px + center;
    vUv = uv;
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

const advectionFragment = `
  precision highp float;
  uniform sampler2D velocity;
  uniform float dt;
  uniform bool isBFECC;
  uniform vec2 fboSize;
  uniform vec2 px;
  varying vec2 uv;
  void main() {
    vec2 ratio = max(fboSize.x, fboSize.y) / fboSize;
    vec2 vel = texture2D(velocity, uv).xy * 2.55;
    vec2 tracedUv = uv - vel * dt * ratio;
    vec2 nextVelocity = texture2D(velocity, tracedUv).xy * 0.98;
    gl_FragColor = vec4(nextVelocity, 0.0, 0.0);
  }
`;

const forceFragment = `
  precision highp float;
  uniform vec2 force;
  varying vec2 vUv;
  void main() {
    vec2 circle = (vUv - 0.5) * 2.0;
    float influence = 1.0 - min(length(circle), 1.0);
    influence *= influence * 1.5;
    gl_FragColor = vec4(force * influence, 1.0, 1.0);
  }
`;

const viscosityFragment = `
  precision highp float;
  uniform sampler2D velocity;
  uniform sampler2D velocity_new;
  uniform float v;
  uniform vec2 px;
  uniform float dt;
  varying vec2 uv;
  void main() {
    vec2 oldVelocity = texture2D(velocity, uv).xy;
    vec2 sum =
      texture2D(velocity_new, uv + vec2(px.x * 2.0, 0.0)).xy +
      texture2D(velocity_new, uv - vec2(px.x * 2.0, 0.0)).xy +
      texture2D(velocity_new, uv + vec2(0.0, px.y * 2.0)).xy +
      texture2D(velocity_new, uv - vec2(0.0, px.y * 2.0)).xy;
    vec2 nextVelocity = (4.0 * oldVelocity + v * dt * sum) /
      (4.0 * (1.0 + v * dt));
    gl_FragColor = vec4(nextVelocity, 0.0, 0.0);
  }
`;

const divergenceFragment = `
  precision highp float;
  uniform sampler2D velocity;
  uniform float dt;
  uniform vec2 px;
  varying vec2 uv;
  void main() {
    float x0 = texture2D(velocity, uv - vec2(px.x, 0.0)).x;
    float x1 = texture2D(velocity, uv + vec2(px.x, 0.0)).x;
    float y0 = texture2D(velocity, uv - vec2(0.0, px.y)).y;
    float y1 = texture2D(velocity, uv + vec2(0.0, px.y)).y;
    float divergence = (x1 - x0 + y1 - y0) * 0.5;
    gl_FragColor = vec4(divergence / dt);
  }
`;

const pressureFragment = `
  precision highp float;
  uniform sampler2D pressure;
  uniform sampler2D divergence;
  uniform vec2 px;
  varying vec2 uv;
  void main() {
    float p0 = texture2D(pressure, uv + vec2(px.x * 2.0, 0.0)).r;
    float p1 = texture2D(pressure, uv - vec2(px.x * 2.0, 0.0)).r;
    float p2 = texture2D(pressure, uv + vec2(0.0, px.y * 2.0)).r;
    float p3 = texture2D(pressure, uv - vec2(0.0, px.y * 2.0)).r;
    float div = texture2D(divergence, uv).r;
    float nextPressure = (p0 + p1 + p2 + p3) * 0.25 - div;
    gl_FragColor = vec4(nextPressure);
  }
`;

const projectFragment = `
  precision highp float;
  uniform sampler2D pressure;
  uniform sampler2D velocity;
  uniform vec2 px;
  uniform float dt;
  varying vec2 uv;
  void main() {
    float p0 = texture2D(pressure, uv + vec2(px.x, 0.0)).r;
    float p1 = texture2D(pressure, uv - vec2(px.x, 0.0)).r;
    float p2 = texture2D(pressure, uv + vec2(0.0, px.y)).r;
    float p3 = texture2D(pressure, uv - vec2(0.0, px.y)).r;
    vec2 projected = texture2D(velocity, uv).xy - vec2(p0 - p1, p2 - p3) * dt * 0.25;
    gl_FragColor = vec4(projected, 0.0, 1.0);
  }
`;

const imageVertexShader = `
  uniform vec2 uMouseL;
  uniform float uLSpeed;
  uniform float uTransColor;
  uniform vec2 uViewport;
  varying vec2 vUv;
  varying vec4 vClipPosition;
  void main() {
    vUv = uv;
    vec4 projected = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vClipPosition = projected;
    gl_Position = projected;
  }
`;

const imageFragmentShader = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform sampler2D uFluidVelocity;
  uniform float uFluidStrength;
  uniform float uHoverLerp;
  uniform float uTransColor;
  uniform vec2 uImageSize;
  uniform vec2 uTextureSize;
  varying vec2 vUv;
  varying vec4 vClipPosition;

  vec2 coverUv(vec2 uv, float imageAspect, float containerAspect) {
    float ratio = imageAspect / containerAspect;
    if (ratio > 1.0) {
      uv.x = 0.5 + (uv.x - 0.5) / ratio;
    } else {
      uv.y = 0.5 + (uv.y - 0.5) * ratio;
    }
    return uv;
  }

  bool isInsideRoundedRect(vec2 uv, float radius, float aspect) {
    vec2 coordinate = uv * 2.0 - 1.0;
    coordinate.y /= aspect;
    coordinate = abs(coordinate);
    vec2 corner = vec2(1.0, 1.0 / aspect) - radius;
    vec2 delta = max(coordinate - corner, 0.0);
    return dot(delta, delta) <= radius * radius;
  }

  void main() {
    float containerAspect = uImageSize.x / max(uImageSize.y, 1.0);
    float textureAspect = uTextureSize.x / max(uTextureSize.y, 1.0);
    float cornerRadius = 20.0 / max(uImageSize.x, 1.0);
    if (!isInsideRoundedRect(vUv, cornerRadius, containerAspect)) discard;

    vec2 mediaUv = coverUv(vUv, textureAspect, containerAspect);
    vec2 screenUv = vClipPosition.xy / vClipPosition.w * 0.5 + 0.5;
    vec2 fluidVelocity = texture2D(uFluidVelocity, screenUv).xy;
    float ratioCorrection = max(containerAspect, 1.0);
    fluidVelocity.x /= ratioCorrection;
    fluidVelocity.y /= ratioCorrection;
    mediaUv -= fluidVelocity * uFluidStrength;

    vec2 rgbOffset = fluidVelocity * uFluidStrength * 0.20;
    vec4 center = texture2D(uTexture, mediaUv);
    vec3 rgb = vec3(
      texture2D(uTexture, mediaUv - rgbOffset).r,
      center.g,
      texture2D(uTexture, mediaUv + rgbOffset).b
    );
    gl_FragColor = vec4(rgb, center.a);
  }
`;
