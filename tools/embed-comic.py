from pathlib import Path

MARKER = "NEST_COMIC_ABOUT_V1"

about_path = Path("about.js")
about = about_path.read_text()

snippet = r'''

/* NEST_COMIC_ABOUT_V1 */
(() => {
  "use strict";

  const dialog = document.getElementById("aboutDialog");
  if (!dialog || dialog.querySelector(".about-comic")) return;

  const section = document.createElement("section");
  section.className = "about-comic";
  section.setAttribute("aria-labelledby", "aboutComicTitle");
  section.innerHTML = `
    <div class="about-section-heading">
      <p class="about-overline">TEGNESERIEN</p>
      <h3 id="aboutComicTitle">Fra flat liste til riktig neste steg.</h3>
      <p>Se hele modellen i én skjermvennlig stripe: problemet, dørprinsippet, arbeidsflyten og hvordan NEST Channel rydder veien videre.</p>
    </div>
    <figure class="about-comic-frame">
      <img src="nest-channel-comic.webp" alt="Tegneserie som forklarer betinget oppgavebehandling i NEST Channel" loading="lazy" decoding="async">
      <figcaption>Klar kan gjøres nå. Venter trenger et ferdig vilkår. Ferdig åpner neste oppgave.</figcaption>
    </figure>
  `;

  const anchor = dialog.querySelector(".about-principles") || dialog.querySelector(".about-product-note");
  if (anchor) anchor.before(section);
  else dialog.querySelector(".about-shell")?.append(section);

  const style = document.createElement("style");
  style.textContent = `
    .about-comic{padding:clamp(1.6rem,5vw,3.5rem);border-bottom:1px solid var(--line)}
    .about-comic .about-section-heading>p:last-child{max-width:760px;margin-top:.85rem;color:#b7c6bd;line-height:1.65}
    .about-comic-frame{margin:1.5rem auto 0;width:min(100%,800px);overflow:hidden;border:1px solid rgba(105,240,174,.24);border-radius:20px;background:#030806;box-shadow:0 22px 70px rgba(0,0,0,.32)}
    .about-comic-frame img{display:block;width:100%;height:auto}
    .about-comic-frame figcaption{padding:.9rem 1rem 1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem;line-height:1.5;text-align:center}
    @media(max-width:560px){.about-comic{padding:1.15rem .8rem}.about-comic-frame{margin-top:1rem;border-radius:14px}.about-comic-frame figcaption{font-size:.75rem}}
  `;
  document.head.append(style);

  const version = dialog.querySelector(".about-footer span");
  if (version) version.textContent = "Versjon 0.4.0 · BLCKSWAN";
})();
'''

if MARKER not in about:
    about_path.write_text(about.rstrip() + snippet + "\n")

gradle_path = Path("android/app/build.gradle")
gradle = gradle_path.read_text()
if "'nest-channel-comic.webp'" not in gradle:
    old = "'icon.svg', 'service-worker.js', 'github-sync.js', 'github-sync.css', 'about.js', 'about.css'"
    new = "'icon.svg', 'nest-channel-comic.webp', 'service-worker.js', 'github-sync.js', 'github-sync.css', 'about.js', 'about.css'"
    if old not in gradle:
        raise SystemExit("Gradle asset marker not found")
    gradle_path.write_text(gradle.replace(old, new, 1))

sw_path = Path("service-worker.js")
sw = sw_path.read_text()
sw = sw.replace('const CACHE = "nest-channel-v3";', 'const CACHE = "nest-channel-v4";')
if '"./nest-channel-comic.webp"' not in sw:
    marker = '"./icon.svg"]'
    if marker not in sw:
        raise SystemExit("Service worker asset marker not found")
    sw = sw.replace(marker, '"./icon.svg", "./nest-channel-comic.webp"]', 1)
sw_path.write_text(sw)

print("Comic integrated into About, Android assets and offline cache.")
