const links = Array.from(document.querySelectorAll('[data-brand-link]'));
const sections = Array.from(document.querySelectorAll('[data-brand-section]'));

const setCurrentBrand = (brand) => {
  links.forEach((link) => {
    if (link.dataset.brandLink === brand) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
};

if ('IntersectionObserver' in window && sections.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setCurrentBrand(visible.target.dataset.brandSection);
    },
    { rootMargin: '-22% 0px -58%', threshold: [0.08, 0.2, 0.4] },
  );
  sections.forEach((section) => observer.observe(section));
}

links.forEach((link) => {
  link.addEventListener('click', () => setCurrentBrand(link.dataset.brandLink));
});
