import { renderAppNav, mountAppNav } from './app-shell';

export function renderLandingPage(): string {
  return `
    <div class="site-page landing-page">
      ${renderAppNav('home')}
      <main class="landing-main">
        <section class="landing-hero">
          <div class="landing-hero-copy">
            <p class="landing-eyebrow">Interactive system design interviews</p>
            <h1>Practice architecture under real load — before the whiteboard</h1>
            <p class="landing-lead">
              BreakIT lets candidates wire services, run traffic simulations, and learn from
              classic interview problems. Engineering teams use it to standardize interviews and see how
              candidates think in motion.
            </p>
            <div class="landing-cta-row">
              <a class="btn btn-primary btn-lg" href="/challenges" data-link>Browse challenges</a>
              <a class="btn btn-secondary btn-lg" href="/sandbox/url-shortener" target="_blank" rel="noopener noreferrer">Try it yourself</a>
            </div>
          </div>
          <div class="landing-hero-visual" aria-hidden="true">
            <div class="landing-preview-card">
              <div class="landing-preview-title">Live simulation</div>
              <div class="landing-preview-grid">
                <span>LB</span><span>→</span><span>API</span><span>→</span><span>DB</span>
              </div>
              <div class="landing-preview-stats">
                <div><strong>200</strong><span>RPS</span></div>
                <div><strong>99.2%</strong><span>uptime</span></div>
                <div><strong>45s</strong><span>scenario</span></div>
              </div>
            </div>
          </div>
        </section>

        <section class="landing-features">
          <article class="feature-card">
            <h3>Interview-ready challenges</h3>
            <p>URL shortener, feed systems, file storage, rate limiters — each with requirements, walkthroughs, and a hands-on sandbox.</p>
          </article>
          <article class="feature-card">
            <h3>See traffic, not just boxes</h3>
            <p>Animated requests, spikes, and failures show whether your design survives load — closer to production than static diagrams.</p>
          </article>
          <article class="feature-card">
            <h3>Built for hiring teams</h3>
            <p>Give every interviewer the same scenarios, scoring lens, and candidate experience. Reduce variance across loops.</p>
          </article>
        </section>
      </main>
      <footer class="site-footer">
        <p>© ${new Date().getFullYear()} BreakIT · Built for engineers preparing for — and running — interviews.</p>
      </footer>
    </div>
  `;
}

export function mountLandingPage(container: HTMLElement): void {
  container.dataset.activeNav = 'home';
  mountAppNav(container);
}
