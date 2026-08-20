import Lenis from "./assets/vendor/lenis.mjs";

const VISUAL_LERP = 0.05;

const scrollState = {
  actualScroll: window.scrollY,
  animatedScroll: window.scrollY,
  targetScroll: window.scrollY,
  velocity: 0,
  visualVelocity: 0,
  direction: 0,
  progress: 0,
  reducedMotion: false,
};

const frameSubscribers = new Set();
let lenis = null;
let rafId = 0;
let previousTime = 0;
let targetVisualVelocity = 0;
let currentVisualVelocity = 0;
let initialized = false;

export function initSiteScroll({ reducedMotion = false } = {}) {
  if (initialized) return { lenis, state: scrollState };
  initialized = true;
  scrollState.reducedMotion = reducedMotion;

  if (reducedMotion) {
    document.documentElement.classList.add("native-scroll");
    window.addEventListener("scroll", updateNativeScrollState, { passive: true });
    rafId = requestAnimationFrame(raf);
    return { lenis: null, state: scrollState };
  }

  lenis = new Lenis({
    lerp: 0.1,
    wheelMultiplier: 1,
    smoothWheel: true,
    syncTouch: false,
    orientation: "vertical",
    gestureOrientation: "vertical",
  });

  lenis.on("scroll", (event) => {
    scrollState.actualScroll = window.scrollY;
    scrollState.animatedScroll = event.scroll;
    scrollState.targetScroll = event.targetScroll;
    scrollState.velocity = event.velocity;
    scrollState.direction = event.direction;
    scrollState.progress = event.progress;
    targetVisualVelocity = event.velocity;
  });

  rafId = requestAnimationFrame(raf);
  return { lenis, state: scrollState };
}

export function subscribeVisualFrame(callback) {
  frameSubscribers.add(callback);
  return () => frameSubscribers.delete(callback);
}

export function scrollToTarget(target) {
  if (lenis && !scrollState.reducedMotion) {
    lenis.scrollTo(target, { offset: 0 });
    return;
  }

  const element = typeof target === "string" ? document.querySelector(target) : target;
  element?.scrollIntoView({ behavior: "auto", block: "start" });
}

function updateNativeScrollState() {
  const limit = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  const nextScroll = window.scrollY;
  scrollState.direction = Math.sign(nextScroll - scrollState.actualScroll);
  scrollState.actualScroll = nextScroll;
  scrollState.animatedScroll = nextScroll;
  scrollState.targetScroll = nextScroll;
  scrollState.velocity = 0;
  scrollState.visualVelocity = 0;
  scrollState.progress = Math.min(nextScroll / limit, 1);
}

function raf(time) {
  const deltaTime = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60;
  previousTime = time;

  if (lenis) lenis.raf(time);
  updateVisualVelocity(deltaTime);

  frameSubscribers.forEach((callback) => callback(scrollState, time, deltaTime));
  rafId = requestAnimationFrame(raf);
}

function updateVisualVelocity(deltaTime) {
  if (scrollState.reducedMotion) {
    currentVisualVelocity = 0;
    targetVisualVelocity = 0;
    scrollState.visualVelocity = 0;
    return;
  }

  const visualFactor = dampFactor(VISUAL_LERP, deltaTime);
  currentVisualVelocity += (targetVisualVelocity - currentVisualVelocity) * visualFactor;
  targetVisualVelocity *= Math.pow(0.92, deltaTime * 60);

  if (Math.abs(targetVisualVelocity) < 0.0001) targetVisualVelocity = 0;
  if (Math.abs(currentVisualVelocity) < 0.0001) currentVisualVelocity = 0;

  scrollState.visualVelocity = currentVisualVelocity;
}

function dampFactor(baseFactor, deltaTime, referenceFps = 60) {
  return 1 - Math.pow(1 - baseFactor, deltaTime * referenceFps);
}

window.addEventListener("pagehide", (event) => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  previousTime = 0;

  if (event.persisted) return;

  lenis?.destroy();
  lenis = null;
  initialized = false;
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !initialized || rafId) return;
  if (scrollState.reducedMotion) updateNativeScrollState();
  rafId = requestAnimationFrame(raf);
});
