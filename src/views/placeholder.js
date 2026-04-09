/*
 * <jamie-placeholder> — used for Train, Eat, Stats tabs in Session 1.
 * Pass data-title and data-session attributes:
 *   <jamie-placeholder data-title="Train" data-session="2"></jamie-placeholder>
 */

class JamiePlaceholder extends HTMLElement {
  connectedCallback() {
    const title = this.dataset.title || 'Coming soon';
    const session = this.dataset.session || '2';
    this.innerHTML = `
      <section class="view">
        <h1>${title}</h1>
        <article class="card">
          <h2>Coming in Session ${session}</h2>
          <p class="muted">This tab is routable but empty for now. Session 1 ships the shell, daily log, and settings.</p>
        </article>
      </section>
    `;
  }
}

customElements.define('jamie-placeholder', JamiePlaceholder);
