const page = document.body;
const commandKey = document.querySelector("[data-command-key]");
const coordinate = document.querySelector("#pointer-coordinate");
const pathStatus = document.querySelector("#path-status");
const cursor = document.querySelector(".error-cursor");
const homeLinks = document.querySelectorAll("[data-home-link], .error-logo");
const keys = Array.from(document.querySelectorAll(".error-key"));
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const pointer = {
  targetX: window.innerWidth * 0.72,
  targetY: window.innerHeight * 0.46,
  x: window.innerWidth * 0.72,
  y: window.innerHeight * 0.46,
};

let pointerVisible = false;
let lastTrailAt = 0;
let frameId = 0;
let calibrationTimer = 0;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const renderPointer = () => {
  pointer.x += (pointer.targetX - pointer.x) * 0.16;
  pointer.y += (pointer.targetY - pointer.y) * 0.16;

  const normalizedX = clamp(pointer.x / window.innerWidth, 0, 1);
  const normalizedY = clamp(pointer.y / window.innerHeight, 0, 1);
  const tiltX = (normalizedX - 0.5) * 10;
  const tiltY = (0.5 - normalizedY) * 8;

  document.documentElement.style.setProperty("--spot-x", `${(normalizedX * 100).toFixed(2)}%`);
  document.documentElement.style.setProperty("--spot-y", `${(normalizedY * 100).toFixed(2)}%`);
  coordinate.textContent = `X ${String(Math.round(normalizedX * 99)).padStart(3, "0")} / Y ${String(Math.round(normalizedY * 99)).padStart(3, "0")}`;

  keys.forEach((key, index) => {
    const depth = index === 1 ? 1 : 0.62;
    const xOffset = (normalizedX - 0.5) * 13 * depth;
    const yOffset = (normalizedY - 0.5) * 10 * depth;
    key.style.transform = `translate3d(${xOffset.toFixed(2)}px, ${yOffset.toFixed(2)}px, 0) rotateX(${(tiltY * depth).toFixed(2)}deg) rotateY(${(tiltX * depth).toFixed(2)}deg)`;
  });

  if (cursor && pointerVisible) {
    cursor.style.transform = `translate3d(${pointer.x.toFixed(2)}px, ${pointer.y.toFixed(2)}px, 0) translate(-50%, -50%)`;
  }

  frameId = requestAnimationFrame(renderPointer);
};

const addTrailStar = (x, y) => {
  const star = document.createElement("span");
  star.className = "trail-star";
  star.setAttribute("aria-hidden", "true");
  star.textContent = "✦";
  star.style.left = `${x}px`;
  star.style.top = `${y}px`;
  document.body.append(star);
  window.setTimeout(() => star.remove(), 780);
};

if (finePointer && !prefersReducedMotion) {
  page.classList.add("has-fine-pointer");

  window.addEventListener(
    "pointermove",
    (event) => {
      pointer.targetX = event.clientX;
      pointer.targetY = event.clientY;
      pointerVisible = true;
      cursor?.classList.add("is-visible");

      if (event.timeStamp - lastTrailAt > 72) {
        lastTrailAt = event.timeStamp;
        addTrailStar(event.clientX, event.clientY);
      }
    },
    { passive: true },
  );

  window.addEventListener("pointerleave", () => {
    pointerVisible = false;
    cursor?.classList.remove("is-visible");
  });

  frameId = requestAnimationFrame(renderPointer);
}

const recalibrate = () => {
  window.clearTimeout(calibrationTimer);
  page.classList.remove("is-calibrated");
  page.classList.remove("is-recalibrating");
  void page.offsetWidth;
  page.classList.add("is-recalibrating");
  pathStatus.textContent = "RECALIBRATING";
  commandKey?.setAttribute("aria-pressed", "true");

  calibrationTimer = window.setTimeout(() => {
    page.classList.remove("is-recalibrating");
    page.classList.add("is-calibrated");
    pathStatus.textContent = "HOME PATH READY";
    commandKey?.setAttribute("aria-pressed", "false");
  }, prefersReducedMotion ? 20 : 1200);
};

commandKey?.addEventListener("click", recalibrate);

const leaveForHome = (event) => {
  if (prefersReducedMotion) return;
  event.preventDefault();
  const href = event.currentTarget.href;
  page.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = href;
  }, 460);
};

homeLinks.forEach((link) => link.addEventListener("click", leaveForHome));

window.addEventListener("keydown", (event) => {
  if (event.key === "0") {
    event.preventDefault();
    commandKey?.focus();
    recalibrate();
  }
});

window.addEventListener("pagehide", () => {
  if (frameId) cancelAnimationFrame(frameId);
  window.clearTimeout(calibrationTimer);
});
