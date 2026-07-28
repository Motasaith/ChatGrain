export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const source = `(() => {
  const current = document.currentScript;
  const agentId = current && current.dataset.agentId;
  if (!agentId || document.querySelector('[data-docent-root="' + agentId + '"]')) return;
  const origin = ${JSON.stringify(origin)};
  const root = document.createElement('div');
  root.dataset.docentRoot = agentId;
  const shadow = root.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = \`
    :host{all:initial}*{box-sizing:border-box}
    button{position:fixed;z-index:2147483001;right:20px;bottom:20px;display:grid;width:58px;height:58px;place-items:center;overflow:hidden;border:0;border-radius:19px;color:#fff;background:#187c52;box-shadow:0 14px 38px rgba(16,35,28,.28);cursor:pointer;font:500 26px system-ui;transition:transform .18s ease}
    button img{width:34px;height:34px;object-fit:contain;border-radius:10px}button svg{width:25px;height:25px}
    button:hover{transform:translateY(-2px)}button:focus-visible{outline:3px solid #91e0b5;outline-offset:3px}
    iframe{position:fixed;z-index:2147483000;right:20px;bottom:90px;width:min(390px,calc(100vw - 28px));height:min(650px,calc(100vh - 118px));border:0;border-radius:20px;background:#fff;box-shadow:0 24px 80px rgba(16,35,28,.3);opacity:0;pointer-events:none;transform:translateY(12px) scale(.98);transform-origin:bottom right;transition:.2s ease}
    :host([data-open]) iframe{opacity:1;pointer-events:auto;transform:none}
    @media(max-width:520px){iframe{inset:12px;width:calc(100vw - 24px);height:calc(100vh - 92px);border-radius:16px}button{right:16px;bottom:14px}}
  \`;
  const frame = document.createElement('iframe');
  frame.title = 'Chat support';
  frame.allow = 'clipboard-write';
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open chat');
  const chatIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
  let agent;
  const renderLauncher = (open) => {
    button.replaceChildren();
    if (open) {
      button.textContent = '×';
      return;
    }
    const imageUrl = agent && (agent.logoUrl || agent.iconUrl);
    if (!imageUrl) {
      button.innerHTML = chatIcon;
      return;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.src = imageUrl;
    image.addEventListener('error', () => {
      button.innerHTML = chatIcon;
    }, { once: true });
    button.append(image);
  };
  renderLauncher(false);
  button.addEventListener('click', () => {
    const open = root.toggleAttribute('data-open');
    renderLauncher(open);
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
  });
  fetch(origin + '/api/public/agents/' + encodeURIComponent(agentId))
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(({data}) => {
      agent = data;
      frame.src = origin + '/widget/' + encodeURIComponent(agentId) + '?token=' + encodeURIComponent(data.embedToken);
      button.style.background = data.primaryColor || '#187c52';
      renderLauncher(root.hasAttribute('data-open'));
      if (data.widgetPosition === 'left') {
        button.style.left = '20px'; button.style.right = 'auto';
        frame.style.left = '20px'; frame.style.right = 'auto';
      }
    }).catch(() => root.remove());
  shadow.append(style, frame, button);
  document.body.append(root);
})();`;
  return new Response(source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
