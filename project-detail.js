import { initSiteScroll } from "./scroll-system.js?v=target-scroll-4";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const loader = document.querySelector(".case-loader");
const portfolioProjectsUrl = new URL("../../index.html#projects", import.meta.url).href;

const referrerUrl = (() => {
  if (!document.referrer) return null;
  try {
    return new URL(document.referrer);
  } catch {
    return null;
  }
})();

const cameFromPortfolio =
  referrerUrl?.origin === window.location.origin &&
  (referrerUrl.pathname === "/" || referrerUrl.pathname.endsWith("/index.html"));

if (!cameFromPortfolio && !history.state?.portfolioDetailEntry) {
  const detailUrl = window.location.href;
  history.replaceState({ portfolioFallbackEntry: true }, "", portfolioProjectsUrl);
  history.pushState({ portfolioDetailEntry: true }, "", detailUrl);
}

window.addEventListener("popstate", (event) => {
  if (!event.state?.portfolioFallbackEntry) return;
  sessionStorage.setItem("portfolio:return-target", "projects");
  window.location.reload();
});

initSiteScroll({ reducedMotion });

document.body.classList.add("is-enhanced");

const hideLoader = () => {
  if (!loader) return;
  loader.classList.remove("is-visible");
  window.setTimeout(() => loader.setAttribute("aria-hidden", "true"), 540);
};

const showLoader = () => {
  if (!loader) return;
  loader.setAttribute("aria-hidden", "false");
  loader.classList.add("is-visible");
};

if (document.readyState === "complete") {
  window.setTimeout(hideLoader, reducedMotion ? 0 : 140);
} else {
  window.addEventListener("load", () => window.setTimeout(hideLoader, reducedMotion ? 0 : 140), { once: true });
}

window.addEventListener("pageshow", hideLoader);

if (!reducedMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.querySelectorAll("[data-magnet]").forEach((item) => {
    let moveFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let itemRect = null;
    const strength = Number(item.dataset.magnetStrength || 0.16);

    const renderMagnet = () => {
      moveFrame = 0;
      const rect = itemRect || item.getBoundingClientRect();
      item.style.setProperty("--magnet-x", `${(pointerX - rect.left - rect.width / 2) * strength}px`);
      item.style.setProperty("--magnet-y", `${(pointerY - rect.top - rect.height / 2) * strength}px`);
    };

    item.addEventListener("pointerenter", () => {
      itemRect = item.getBoundingClientRect();
    });

    item.addEventListener("pointermove", (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!moveFrame) moveFrame = window.requestAnimationFrame(renderMagnet);
    });

    item.addEventListener("pointerleave", () => {
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      itemRect = null;
      item.style.setProperty("--magnet-x", "0px");
      item.style.setProperty("--magnet-y", "0px");
    });
  });
}

const heroRippleImages = document.querySelectorAll("img.webgl[data-fluid-figure]");
const miniappVisitButton = document.querySelector("[data-miniapp-visit]");
const miniappVisitMessage = document.querySelector("[data-miniapp-visit-message]");

if (miniappVisitButton && miniappVisitMessage) {
  miniappVisitButton.addEventListener("click", () => {
    miniappVisitMessage.classList.add("is-visible");
    miniappVisitButton.setAttribute("aria-expanded", "true");
  });
}

if (heroRippleImages.length && !reducedMotion) {
  let rippleStarted = false;
  const startRipple = async () => {
    if (rippleStarted) return;
    rippleStarted = true;
    const { initGlobalWebGLImages } = await import("./profile-image-ripple.js?v=profile-ripple-25");
    initGlobalWebGLImages(heroRippleImages);
  };

  const rippleFrame = heroRippleImages[0]?.closest("[data-ripple-frame]");
  rippleFrame?.addEventListener("transitionend", startRipple, { once: true });
  window.setTimeout(startRipple, 1000);
}

document.querySelectorAll("[data-back-projects]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    sessionStorage.setItem("portfolio:return-target", "projects");
    showLoader();
    window.setTimeout(() => window.location.assign(portfolioProjectsUrl), reducedMotion ? 0 : 300);
  });
});

const revealItems = document.querySelectorAll("[data-reveal]");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-inview"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-inview");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 },
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

const gallery = document.querySelector("[data-scroll-gallery]");
const galleryTrack = document.querySelector("[data-gallery-track]");
const splitterRail = document.querySelector("[data-splitter-rail]");
const splitterLetters = [...document.querySelectorAll("[data-split-letter]")];
const splitterMedia = [...document.querySelectorAll("[data-split-media]")];
const splitterDesktop = window.matchMedia("(min-width: 1101px)");
let scrollFrame = 0;
let scrollGeometryDirty = true;
const scrollGeometry = {
  galleryTop: 0,
  galleryRange: 1,
  galleryMaxShift: 0,
  splitterTop: 0,
  splitterRange: 1,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutQuart = (value) => 1 - (1 - value) ** 4;

const measureScrollGeometry = () => {
  if (gallery && galleryTrack) {
    const galleryRect = gallery.getBoundingClientRect();
    scrollGeometry.galleryTop = galleryRect.top + window.scrollY;
    scrollGeometry.galleryRange = Math.max(galleryRect.height - window.innerHeight, 1);
    scrollGeometry.galleryMaxShift = Math.max(galleryTrack.scrollWidth - window.innerWidth, 0);
  }

  if (splitterRail) {
    const splitterRect = splitterRail.getBoundingClientRect();
    scrollGeometry.splitterTop = splitterRect.top + window.scrollY;
    scrollGeometry.splitterRange = Math.max(splitterRect.height - window.innerHeight, 1);
  }

  scrollGeometryDirty = false;
};

const renderSplitter = () => {
  if (!splitterRail || !splitterLetters.length || !splitterMedia.length) return;

  if (reducedMotion || !splitterDesktop.matches) {
    splitterLetters.forEach((letter) => letter.style.setProperty("--split-letter-y", "0vh"));
    splitterMedia.forEach((item) => {
      item.style.setProperty("--split-media-y", "0px");
      item.style.setProperty("--split-clip", "0% 0%, 100% 0%, 100% 100%, 0% 100%");
    });
    return;
  }

  const progress = clamp(
    (window.scrollY - scrollGeometry.splitterTop) / scrollGeometry.splitterRange,
    0,
    1,
  );

  splitterLetters.forEach((letter) => {
    const direction = Number(letter.dataset.direction || 0);
    letter.style.setProperty("--split-letter-y", `${direction * 35 * progress}vh`);
  });

  splitterMedia.forEach((item) => {
    const amplitude = Number(item.dataset.amplitude || 0);
    const revealStart = Number(item.dataset.revealStart || 0);
    const reveal = easeOutQuart(clamp((progress - revealStart) / 0.12, 0, 1));
    const inset = 50 * (1 - reveal);

    item.style.setProperty("--split-media-y", `${amplitude * (1 - 2 * progress)}px`);
    item.style.setProperty(
      "--split-clip",
      `${inset}% ${inset}%, ${100 - inset}% ${inset}%, ${100 - inset}% ${100 - inset}%, ${inset}% ${100 - inset}%`,
    );
  });
};

const renderScrollEffects = () => {
  scrollFrame = 0;
  if (scrollGeometryDirty) measureScrollGeometry();

  if (!reducedMotion && gallery && galleryTrack) {
    const galleryProgress = clamp(
      (window.scrollY - scrollGeometry.galleryTop) / scrollGeometry.galleryRange,
      0,
      1,
    );
    galleryTrack.style.setProperty(
      "--gallery-x",
      `${-scrollGeometry.galleryMaxShift * galleryProgress}px`,
    );
  }

  renderSplitter();
};

const requestScrollRender = () => {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(renderScrollEffects);
};

window.addEventListener("scroll", requestScrollRender, { passive: true });
window.addEventListener("resize", () => {
  scrollGeometryDirty = true;
  requestScrollRender();
}, { passive: true });
window.addEventListener("load", () => {
  scrollGeometryDirty = true;
  requestScrollRender();
}, { once: true });

if ("ResizeObserver" in window) {
  const scrollGeometryObserver = new ResizeObserver(() => {
    scrollGeometryDirty = true;
    requestScrollRender();
  });
  if (gallery) scrollGeometryObserver.observe(gallery);
  if (galleryTrack) scrollGeometryObserver.observe(galleryTrack);
  if (splitterRail) scrollGeometryObserver.observe(splitterRail);
}
requestScrollRender();

const highlightSection = document.querySelector("[data-highlight-slider]");
const highlightTrack = document.querySelector("[data-highlight-track]");
const highlightProgress = document.querySelector("[data-highlight-progress]");
const highlightPrev = document.querySelector("[data-highlight-prev]");
const highlightNext = document.querySelector("[data-highlight-next]");
const highlightCount = highlightTrack?.children.length || 0;
let highlightIndex = 0;

const renderHighlight = () => {
  if (!highlightSection || !highlightTrack || !highlightProgress || !highlightCount) return;
  const indexValue = String(highlightIndex);
  highlightTrack.style.setProperty("--highlight-index", indexValue);
  highlightProgress.style.setProperty("--highlight-index", indexValue);
  highlightPrev?.setAttribute("aria-disabled", String(highlightIndex === 0));
  highlightNext?.setAttribute("aria-disabled", String(highlightIndex === highlightCount - 1));
};

highlightPrev?.addEventListener("click", () => {
  highlightIndex = (highlightIndex - 1 + highlightCount) % highlightCount;
  renderHighlight();
});

highlightNext?.addEventListener("click", () => {
  highlightIndex = (highlightIndex + 1) % highlightCount;
  renderHighlight();
});

renderHighlight();
