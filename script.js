import { initSiteScroll, scrollToTarget, subscribeVisualFrame } from "./scroll-system.js?v=target-scroll-4";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
initSiteScroll({ reducedMotion: prefersReducedMotion });

if (!prefersReducedMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
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

const globalCursor = document.querySelector(".global-cursor");

if (globalCursor && window.matchMedia("(pointer: fine)").matches) {
  const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const current = { x: target.x, y: target.y };
  const followRate = prefersReducedMotion ? 1 : 0.18;
  let cursorVisible = false;
  let cursorRafId = 0;

  const updateGlobalCursor = (event) => {
    target.x = event.clientX;
    target.y = event.clientY;
    if (!cursorVisible) {
      cursorVisible = true;
      globalCursor.classList.add("is-visible");
    }
    if (!cursorRafId) cursorRafId = requestAnimationFrame(renderGlobalCursor);
  };

  const hideGlobalCursor = () => {
    cursorVisible = false;
    globalCursor.classList.remove("is-visible");
    if (cursorRafId) {
      cancelAnimationFrame(cursorRafId);
      cursorRafId = 0;
    }
  };

  const renderGlobalCursor = () => {
    current.x += (target.x - current.x) * followRate;
    current.y += (target.y - current.y) * followRate;
    globalCursor.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%)`;
    const cursorSettled =
      Math.abs(target.x - current.x) < 0.05 && Math.abs(target.y - current.y) < 0.05;
    cursorRafId = cursorVisible && !cursorSettled ? requestAnimationFrame(renderGlobalCursor) : 0;
  };

  window.addEventListener("pointermove", updateGlobalCursor, { passive: true });
  window.addEventListener("pointerleave", hideGlobalCursor, { passive: true });
  renderGlobalCursor();
}

const routeLoader = document.querySelector(".route-loader");
let routeLoaderShowTimer = 0;
let routeLoaderHideTimer = 0;

const resetRouteLoader = () => {
  if (!routeLoader) return;
  window.clearTimeout(routeLoaderShowTimer);
  window.clearTimeout(routeLoaderHideTimer);
  routeLoader.classList.remove("is-visible");
  routeLoader.setAttribute("aria-hidden", "true");
};

const playRouteLoader = ({ hold = false } = {}) => {
  if (!routeLoader) return;

  window.clearTimeout(routeLoaderShowTimer);
  window.clearTimeout(routeLoaderHideTimer);
  routeLoader.setAttribute("aria-hidden", "false");
  routeLoaderShowTimer = window.setTimeout(() => {
    routeLoader.classList.add("is-visible");
  }, 80);
  if (!hold) {
    routeLoaderHideTimer = window.setTimeout(() => {
      routeLoader.classList.remove("is-visible");
      routeLoader.setAttribute("aria-hidden", "true");
    }, 360);
  }
};

document.querySelectorAll("[data-project-card], [data-route-transition]").forEach((element) => {
  element.addEventListener("click", (event) => {
    const href = element.getAttribute("href");
    const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    const shouldNavigate = href && !isModifiedClick && element.getAttribute("target") !== "_blank";

    if (!shouldNavigate) {
      playRouteLoader();
      return;
    }

    event.preventDefault();
    playRouteLoader({ hold: true });
    window.setTimeout(() => {
      window.location.href = href;
    }, 360);
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      entry.target.classList.add("is-visible");
      if (!prefersReducedMotion && entry.target.classList.contains("border-glow")) {
        runGlowSweep(entry.target);
      }
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.18 },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;

    const target = document.querySelector(hash);
    if (!target) return;

    event.preventDefault();
    scrollToTarget(target);
    history.pushState(null, "", hash);
  });
});

const restoreHashTarget = () => {
  if (!window.location.hash) return;
  const targetId = decodeURIComponent(window.location.hash.slice(1));
  const target = document.getElementById(targetId);
  if (!target) return;

  const restoreTargetPosition = () => target.scrollIntoView({ block: "start", behavior: "auto" });
  window.requestAnimationFrame(() => {
    restoreTargetPosition();
    window.requestAnimationFrame(restoreTargetPosition);
    window.setTimeout(restoreTargetPosition, 80);
  });
};

window.addEventListener("pageshow", () => {
  resetRouteLoader();
  restoreHashTarget();
});
restoreHashTarget();

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function animateValue({ start, end, duration, delay = 0, onUpdate, onEnd }) {
  const startTime = performance.now() + delay;

  function tick(now) {
    const elapsed = Math.max(now - startTime, 0);
    const progress = Math.min(elapsed / duration, 1);
    onUpdate(start + (end - start) * easeOutCubic(progress));

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else if (onEnd) {
      onEnd();
    }
  }

  setTimeout(() => requestAnimationFrame(tick), delay);
}

function runGlowSweep(card) {
  card.classList.add("sweep-active");
  card.style.setProperty("--mouse-x", "50%");
  card.style.setProperty("--mouse-y", "6%");

  animateValue({
    start: 0,
    end: 0.9,
    duration: 520,
    onUpdate: (value) => card.style.setProperty("--glow-alpha", value.toFixed(3)),
  });

  animateValue({
    start: 6,
    end: 94,
    duration: 1500,
    onUpdate: (value) => card.style.setProperty("--mouse-y", `${value.toFixed(2)}%`),
  });

  animateValue({
    start: 0.9,
    end: 0,
    duration: 760,
    delay: 1120,
    onUpdate: (value) => card.style.setProperty("--glow-alpha", value.toFixed(3)),
    onEnd: () => card.classList.remove("sweep-active"),
  });
}

function edgeIntensity(rect, x, y) {
  const nearestEdge = Math.min(x, y, rect.width - x, rect.height - y);
  const triggerDistance = Math.min(rect.width, rect.height) * 0.42;
  const raw = 1 - nearestEdge / triggerDistance;

  return Math.max(0, Math.min(raw, 1));
}

document.querySelectorAll(".border-glow").forEach((card) => {
  let cardRect = null;

  card.addEventListener("pointerenter", () => {
    cardRect = card.getBoundingClientRect();
  });

  card.addEventListener("pointermove", (event) => {
    const rect = cardRect || card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const alpha = edgeIntensity(rect, x, y);

    card.style.setProperty("--mouse-x", `${x.toFixed(1)}px`);
    card.style.setProperty("--mouse-y", `${y.toFixed(1)}px`);
    card.style.setProperty("--glow-alpha", alpha.toFixed(3));
  });

  card.addEventListener("pointerleave", () => {
    cardRect = null;
    card.style.setProperty("--glow-alpha", "0");
  });
});

const ambientStage = document.querySelector(".ambient-stage");
const commandHotspot = document.querySelector(".command-hotspot");
const ambientVideo = document.querySelector(".ambient-video");

if (ambientStage && commandHotspot && ambientVideo) {
  let isHighlighted = false;

  const getSweepDuration = () => {
    const duration = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--command-sweep-duration"),
    );
    return Number.isFinite(duration) && duration > 0 ? duration : 1.2;
  };

  const finishHighlight = () => {
    if (!isHighlighted) return;
    ambientStage.classList.remove("is-transitioning");
    ambientStage.classList.add("is-highlighted");
  };

  const activateHighlight = () => {
    if (isHighlighted) return;
    isHighlighted = true;
    commandHotspot.setAttribute("aria-pressed", "true");

    if (prefersReducedMotion) {
      finishHighlight();
      return;
    }

    ambientStage.classList.remove("is-highlighted");
    ambientStage.classList.add("is-transitioning");
    ambientVideo.currentTime = 0;
    if (ambientVideo.duration) {
      ambientVideo.playbackRate = ambientVideo.duration / getSweepDuration();
    }
    ambientVideo.play().catch(finishHighlight);
  };

  const deactivateHighlight = () => {
    if (commandHotspot.matches(":hover") || document.activeElement === commandHotspot) return;
    isHighlighted = false;
    commandHotspot.setAttribute("aria-pressed", "false");
    ambientStage.classList.remove("is-transitioning", "is-highlighted");
    ambientVideo.pause();
    ambientVideo.currentTime = 0;
    ambientVideo.playbackRate = 1;
  };

  commandHotspot.addEventListener("pointerenter", activateHighlight);
  commandHotspot.addEventListener("pointerleave", deactivateHighlight);
  commandHotspot.addEventListener("focus", activateHighlight);
  commandHotspot.addEventListener("blur", deactivateHighlight);
  ambientVideo.addEventListener("ended", finishHighlight);
  document.body.classList.add("hero-interaction-ready");
}

const workCurtainCanvas = document.querySelector(".work-veil-canvas");
const workCurtain = workCurtainCanvas?.closest(".work-veil");
const workFallbackImage = workCurtain?.querySelector(".work-veil-image");

// Keep the static layer visible until WebGL has rendered a valid frame.
workCurtain?.classList.add("is-fallback");

const loadWorkFallback = () => {
  if (!workFallbackImage || workFallbackImage.src) return;
  workFallbackImage.src = workFallbackImage.dataset.src || "";
};

if (prefersReducedMotion) loadWorkFallback();

if (workCurtainCanvas && !prefersReducedMotion) {
  const workSection = workCurtainCanvas.closest(".work-interlude");
  let sceneStarted = false;

  const startGlassScene = async () => {
    if (sceneStarted) return;
    sceneStarted = true;

    const { initGlassCurtainScene } = await import("./glass-scene.js?v=reference-glass-62");
    initGlassCurtainScene(workCurtainCanvas);
    if (workCurtain?.classList.contains("is-fallback")) loadWorkFallback();
  };

  if (workSection) {
    const sceneObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        sceneObserver.disconnect();
        startGlassScene().catch(() => {
          sceneStarted = false;
          loadWorkFallback();
          workCurtain?.classList.add("is-fallback");
        });
      },
      { rootMargin: "100% 0px" },
    );
    sceneObserver.observe(workSection);
  }
}

const rippleImages = document.querySelectorAll("img.webgl[data-fluid-figure]");

if (rippleImages.length && !prefersReducedMotion) {
  let rippleStarted = false;
  const rippleSections = Array.from(
    new Set(Array.from(rippleImages, (image) => image.closest("section")).filter(Boolean)),
  );
  const startProfileRipple = async () => {
    if (rippleStarted) return;
    rippleStarted = true;

    const { initGlobalWebGLImages } = await import("./profile-image-ripple.js?v=profile-ripple-26");
    initGlobalWebGLImages(rippleImages);
  };

  if (rippleSections.length) {
    const rippleObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        rippleObserver.disconnect();
        startProfileRipple().catch(() => {
          rippleStarted = false;
        });
      },
      { rootMargin: "180px 0px" },
    );
    rippleSections.forEach((section) => rippleObserver.observe(section));
  }
}

const serviceStack = document.querySelector(".service-stack");
const serviceSlides = Array.from(document.querySelectorAll(".service-slide"));

if (serviceStack && serviceSlides.length > 1) {
  const serviceImages = serviceSlides.map((slide) => slide.querySelector(".service-slide-image"));
  let serviceImagesPromoted = false;
  let serviceStackTop = serviceStack.offsetTop;
  let serviceStackTravel = Math.max(serviceStack.offsetHeight - window.innerHeight, 1);
  const slideRenderState = serviceSlides.map(() => ({ transform: "", opacity: "", active: null }));

  const measureServiceStack = () => {
    serviceStackTop = serviceStack.offsetTop;
    serviceStackTravel = Math.max(serviceStack.offsetHeight - window.innerHeight, 1);
  };

  const serviceStackResizeObserver = new ResizeObserver(measureServiceStack);
  serviceStackResizeObserver.observe(serviceStack);
  window.addEventListener("resize", measureServiceStack, { passive: true });

  const renderServiceSlide = (slide, index, offset, opacity, active) => {
    const nextTransform = `translate3d(${offset}%, 0, 0)`;
    const nextOpacity = String(opacity);
    const state = slideRenderState[index];

    if (state.transform !== nextTransform) {
      slide.style.transform = nextTransform;
      state.transform = nextTransform;
    }
    if (state.opacity !== nextOpacity) {
      slide.querySelector(".service-slide-shade").style.opacity = nextOpacity;
      state.opacity = nextOpacity;
    }
    if (state.active !== active) {
      slide.classList.toggle("is-active", active);
      state.active = active;
    }
  };

  const updateServiceStack = (scrollState) => {
    if (!serviceImagesPromoted && scrollState.animatedScroll >= serviceStackTop - window.innerHeight) {
      serviceImagesPromoted = true;
      serviceImages.forEach((image, index) => {
        image.loading = "eager";
        image.fetchPriority = index === 0 ? "high" : "low";
      });
    }

    const progress = Math.min(
      Math.max((scrollState.animatedScroll - serviceStackTop) / serviceStackTravel, 0),
      1,
    );
    const maxTransition = serviceSlides.length - 1;

    if (progress >= 1) {
      serviceSlides.forEach((slide, index) => {
        renderServiceSlide(slide, index, index === maxTransition ? 0 : -100, 0.32, index === maxTransition);
      });
      return;
    }

    const transition = progress * maxTransition;
    const currentIndex = Math.min(Math.floor(transition), maxTransition - 1);
    const localProgress = transition - currentIndex;
    const shadeOpacity = String(0.16 + progress * 0.16);

    serviceSlides.forEach((slide, index) => {
      let offset = 100;
      if (index < currentIndex) offset = -100;
      if (index === currentIndex) offset = -localProgress * 100;
      if (index === currentIndex + 1) offset = (1 - localProgress) * 100;

      const opacity =
        index === currentIndex || index === currentIndex + 1
          ? shadeOpacity
          : index < currentIndex
            ? 0.32
            : 0;
      renderServiceSlide(
        slide,
        index,
        offset,
        opacity,
        index === currentIndex || index === currentIndex + 1,
      );
    });
  };

  subscribeVisualFrame(updateServiceStack);
  updateServiceStack({ animatedScroll: window.scrollY });
}

const experienceItems = Array.from(document.querySelectorAll("[data-experience-item]"));

if (experienceItems.length) {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let lockedItem = null;

  const setItemOpen = (item, open) => {
    item.classList.toggle("is-open", open);
    item.querySelector(".experience-trigger")?.setAttribute("aria-expanded", String(open));
  };

  const showOnly = (item) => {
    experienceItems.forEach((candidate) => setItemOpen(candidate, candidate === item));
  };

  experienceItems.forEach((item) => {
    const trigger = item.querySelector(".experience-trigger");
    if (!trigger) return;

    trigger.addEventListener("click", () => {
      if (lockedItem === item) {
        lockedItem = null;
        setItemOpen(item, false);
        return;
      }

      lockedItem = item;
      showOnly(item);
    });

    item.addEventListener("pointerenter", () => {
      if (!finePointer.matches) return;
      showOnly(item);
    });

    item.addEventListener("pointerleave", () => {
      if (!finePointer.matches) return;
      if (lockedItem) {
        showOnly(lockedItem);
      } else {
        setItemOpen(item, false);
      }
    });

    trigger.addEventListener("focus", () => {
      if (finePointer.matches) showOnly(item);
    });

    trigger.addEventListener("blur", () => {
      if (!finePointer.matches) return;
      if (lockedItem) {
        showOnly(lockedItem);
      } else {
        setItemOpen(item, false);
      }
    });
  });
}

const contactConsole = document.querySelector("[data-contact-console]");
const contactChannels = Array.from(document.querySelectorAll("[data-contact-channel]"));
const contactStatus = document.querySelector(".contact-status");

if (contactConsole && contactChannels.length) {
  let activeChannel = null;
  let contactPositionFrame = 0;

  const positionContactSignal = (channel) => {
    if (!channel) return;
    activeChannel = channel;
    contactConsole.classList.add("has-active-contact");
    contactChannels.forEach((candidate) => candidate.classList.toggle("is-active", candidate === channel));
    const consoleRect = contactConsole.getBoundingClientRect();
    const channelRect = channel.getBoundingClientRect();
    const signalY = channelRect.top - consoleRect.top + channelRect.height / 2;
    contactConsole.style.setProperty("--contact-signal-y", `${signalY.toFixed(2)}px`);
  };

  const scheduleContactSignal = () => {
    if (!activeChannel) return;
    cancelAnimationFrame(contactPositionFrame);
    contactPositionFrame = requestAnimationFrame(() => positionContactSignal(activeChannel));
  };

  const clearContactSignal = () => {
    activeChannel = null;
    contactConsole.classList.remove("has-active-contact");
    contactChannels.forEach((channel) => channel.classList.remove("is-active"));
  };

  contactChannels.forEach((channel) => {
    channel.addEventListener("pointerenter", () => positionContactSignal(channel));
    channel.addEventListener("focusin", () => positionContactSignal(channel));
  });

  contactConsole.addEventListener("pointerleave", () => {
    if (!contactConsole.contains(document.activeElement)) clearContactSignal();
  });

  contactConsole.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (!contactConsole.contains(document.activeElement)) clearContactSignal();
    });
  });

  window.addEventListener("resize", scheduleContactSignal, { passive: true });
  document.fonts?.ready?.then(scheduleContactSignal);
}

const copyText = async (value) => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
};

document.querySelectorAll("[data-copy-value]").forEach((button) => {
  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    try {
      await copyText(button.dataset.copyValue || "");
      button.textContent = "COPIED";
      button.classList.add("is-copied");
      if (contactStatus) contactStatus.textContent = "已复制到剪贴板";
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove("is-copied");
        if (contactStatus) contactStatus.textContent = "";
      }, 1600);
    } catch {
      if (contactStatus) contactStatus.textContent = "复制失败，请手动选择文字";
    }
  });
});

const qrDialog = document.querySelector("#wechat-qr-dialog");

if (qrDialog) {
  document.querySelectorAll("[data-qr-open]").forEach((button) => {
    button.addEventListener("click", () => {
      if (typeof qrDialog.showModal === "function") {
        qrDialog.showModal();
      } else {
        qrDialog.setAttribute("open", "");
      }
    });
  });

  qrDialog.querySelector("[data-qr-close]")?.addEventListener("click", () => qrDialog.close());
  qrDialog.addEventListener("click", (event) => {
    if (event.target === qrDialog) qrDialog.close();
  });
}
