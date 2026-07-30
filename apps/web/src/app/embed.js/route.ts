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
    button[data-unread]::after{position:absolute;top:-4px;right:-4px;display:grid;min-width:22px;height:22px;place-items:center;border:2px solid #fff;border-radius:999px;padding:0 5px;color:#fff;background:#d53f3f;content:attr(data-unread);font:700 11px system-ui}
    button:hover{transform:translateY(-2px)}button:focus-visible{outline:3px solid #91e0b5;outline-offset:3px}
    iframe{position:fixed;z-index:2147483000;right:20px;bottom:90px;width:min(390px,calc(100vw - 28px));height:min(650px,calc(100vh - 118px));border:0;border-radius:20px;background:#fff;box-shadow:0 24px 80px rgba(16,35,28,.3);opacity:0;pointer-events:none;transform:translateY(12px) scale(.98);transform-origin:bottom right;transition:.2s ease}
    .docent-teasers{position:fixed;z-index:2147483001;right:20px;bottom:94px;display:grid;width:min(360px,calc(100vw - 32px));gap:10px;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .docent-teasers p{margin:0 0 0 auto;border:1px solid rgba(25,45,36,.13);border-radius:14px;padding:14px 17px;color:#15251e;background:#fff;box-shadow:0 12px 35px rgba(16,35,28,.16);cursor:pointer;font-size:15px;line-height:1.4;pointer-events:auto}
    .docent-teasers p:first-child{margin-right:8px}
    :host([data-teasers]) .docent-teasers{opacity:1;transform:none}
    .docent-attention{position:fixed;z-index:2147483001;right:86px;bottom:28px;display:flex;align-items:center;gap:7px;border:1px solid rgba(25,45,36,.12);border-radius:999px;padding:8px 12px;color:#17271f;background:#fff;box-shadow:0 10px 28px rgba(16,35,28,.16);opacity:0;pointer-events:none;transform:translateX(7px);transition:opacity .2s ease,transform .2s ease;font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .docent-attention span{font-size:16px}
    :host([data-attention]) .docent-attention{opacity:1;transform:none}
    :host([data-open]) iframe{opacity:1;pointer-events:auto;transform:none}
    :host([data-open]) .docent-teasers,:host([data-open]) .docent-attention{opacity:0;pointer-events:none}
    @media(max-width:520px){iframe{inset:12px;width:calc(100vw - 24px);height:calc(100vh - 92px);border-radius:16px}button{right:16px;bottom:14px}.docent-teasers{right:16px;bottom:86px;width:calc(100vw - 32px)}.docent-attention{right:80px;bottom:22px}}
  \`;
  const frame = document.createElement('iframe');
  frame.title = 'Chat support';
  frame.allow = 'microphone; clipboard-write';
  const focusComposer = () => {
    if (!root.hasAttribute('data-open')) return;
    frame.focus({ preventScroll: true });
    try { frame.contentWindow.focus(); } catch {}
    try {
      frame.contentWindow.postMessage({ type: 'docent:focus-composer' }, origin);
    } catch {}
  };
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow.postMessage({
        type: 'docent:visibility',
        open: root.hasAttribute('data-open')
      }, origin);
    } catch {}
    window.setTimeout(focusComposer, 60);
    window.setTimeout(focusComposer, 240);
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open chat');
  const teasers = document.createElement('aside');
  teasers.className = 'docent-teasers';
  teasers.setAttribute('aria-label', 'Chat suggestions');
  const attention = document.createElement('div');
  attention.className = 'docent-attention';
  attention.innerHTML = '<span aria-hidden="true">👋</span><b></b>';
  const chatIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
  let agent;
  let engaged = false;
  try {
    engaged = localStorage.getItem('docent:engaged:' + agentId) === '1';
  } catch {}
  const rememberEngagement = () => {
    engaged = true;
    try { localStorage.setItem('docent:engaged:' + agentId, '1'); } catch {}
  };
  const renderClosedMessage = () => {
    root.removeAttribute('data-teasers');
    root.removeAttribute('data-attention');
    if (!agent || root.hasAttribute('data-open')) return;
    if (engaged) {
      if (agent.attentionMessage) root.setAttribute('data-attention', '');
      return;
    }
    if (Array.isArray(agent.teaserMessages) && agent.teaserMessages.length) {
      root.setAttribute('data-teasers', '');
    }
  };
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
  const setWidgetOpen = (open) => {
    root.toggleAttribute('data-open', open);
    if (open) rememberEngagement();
    renderLauncher(open);
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    if (open) {
      try {
        frame.contentWindow.postMessage({ type: 'docent:visibility', open: true }, origin);
      } catch {}
      window.requestAnimationFrame(focusComposer);
      window.setTimeout(focusComposer, 100);
      window.setTimeout(focusComposer, 320);
    } else {
      try {
        frame.contentWindow.postMessage({ type: 'docent:visibility', open: false }, origin);
      } catch {}
      button.focus({ preventScroll: true });
    }
    renderClosedMessage();
  };
  button.addEventListener('click', () => {
    setWidgetOpen(!root.hasAttribute('data-open'));
  });
  window.addEventListener('message', event => {
    if (
      event.source !== frame.contentWindow ||
      event.data?.type !== 'docent:unread' ||
      event.data?.agentId !== agentId
    ) return;
    const count = Math.max(0, Math.min(99, Number(event.data.count) || 0));
    if (count) button.dataset.unread = String(count);
    else delete button.dataset.unread;
    button.setAttribute(
      'aria-label',
      root.hasAttribute('data-open')
        ? 'Close chat'
        : count
          ? 'Open chat, ' + count + ' unread ' + (count === 1 ? 'reply' : 'replies')
          : 'Open chat'
    );
  });
  fetch(origin + '/api/public/agents/' + encodeURIComponent(agentId))
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(({data}) => {
      agent = data;
      frame.src = origin + '/widget/' + encodeURIComponent(agentId) + '?token=' + encodeURIComponent(data.embedToken);
      button.style.background = data.primaryColor || '#187c52';
      teasers.replaceChildren();
      (Array.isArray(data.teaserMessages) ? data.teaserMessages : [])
        .slice(0, 3)
        .forEach(message => {
          const item = document.createElement('p');
          item.textContent = message;
          item.tabIndex = 0;
          item.setAttribute('role', 'button');
          item.addEventListener('click', () => setWidgetOpen(true));
          item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setWidgetOpen(true);
            }
          });
          teasers.append(item);
        });
      attention.querySelector('b').textContent = data.attentionMessage || '';
      renderLauncher(root.hasAttribute('data-open'));
      if (data.widgetPosition === 'left') {
        root.setAttribute('data-left', '');
        button.style.left = '20px'; button.style.right = 'auto';
        frame.style.left = '20px'; frame.style.right = 'auto';
        teasers.style.left = '20px'; teasers.style.right = 'auto';
        attention.style.left = '86px'; attention.style.right = 'auto';
      }
      window.setTimeout(renderClosedMessage, 700);
    }).catch(() => root.remove());
  shadow.append(style, frame, teasers, attention, button);
  document.body.append(root);
})();`;
  return new Response(source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control":
        process.env.NODE_ENV === "development"
          ? "no-store"
          : "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
