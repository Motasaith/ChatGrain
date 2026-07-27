<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Docent — AI agents trained on your knowledge</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link href="https://cdn.jsdelivr.net/fontsource/css/bricolage-grotesque@latest/latin-500-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/bricolage-grotesque@latest/latin-600-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/bricolage-grotesque@latest/latin-700-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/bricolage-grotesque@latest/latin-800-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/figtree@latest/latin-400-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/figtree@latest/latin-500-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/figtree@latest/latin-600-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/figtree@latest/latin-700-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/ibm-plex-mono@latest/latin-400-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/ibm-plex-mono@latest/latin-500-normal.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/fontsource/css/ibm-plex-mono@latest/latin-600-normal.min.css" rel="stylesheet">
<style>
:root{
  --ink:#0d211a; --pine:#123127; --pine2:#1a4434; --pine3:#23573f;
  --paper:#f2f5ee; --panel:#ffffff; --panel2:#f8faf4;
  --green:#177e51; --green-d:#0f5f3c; --mint:#8fe3b4; --mint-dim:#c4e9d5;
  --amber:#f2a93b; --amber-d:#b0770d; --coral:#ee6c4d; --sky:#4d9de0; --plum:#8e6bd8;
  --line:#dfe6d8; --line2:#c9d5c4;
  --txt:#1c2a24; --mut:#5f7168;
  --sh:0 1px 2px rgba(13,33,26,.05),0 10px 30px -14px rgba(13,33,26,.22);
  --sh-lg:0 2px 4px rgba(13,33,26,.06),0 24px 60px -20px rgba(13,33,26,.35);
  --disp:'Bricolage Grotesque',system-ui,sans-serif;
  --body:'Figtree',system-ui,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:var(--body);color:var(--txt);background:var(--paper);-webkit-font-smoothing:antialiased;overflow-x:hidden}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font-family:inherit;font-size:inherit;color:inherit}
a{color:inherit;text-decoration:none}
::selection{background:var(--mint);color:var(--ink)}
.ic{display:inline-flex;flex-shrink:0}
h1,h2,h3,.disp{font-family:var(--disp)}
.mono{font-family:var(--mono)}

.btn{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14.5px;padding:11px 20px;border-radius:9px;transition:transform .18s,box-shadow .18s,background .18s,border-color .18s;white-space:nowrap;border:1.5px solid transparent}
.btn .ic{transition:transform .18s}
.btn:hover .ic.arr{transform:translateX(3px)}
.btn-p{background:var(--green);color:#fff;box-shadow:0 6px 16px -6px rgba(23,126,81,.55)}
.btn-p:hover{background:var(--green-d);transform:translateY(-2px);box-shadow:0 10px 22px -6px rgba(23,126,81,.6)}
.btn-o{border-color:var(--line2);background:var(--panel);color:var(--txt)}
.btn-o:hover{border-color:var(--green);color:var(--green-d);transform:translateY(-2px)}
.btn-g{color:var(--mut)}
.btn-g:hover{color:var(--green-d);background:rgba(23,126,81,.08)}
.btn-d{border-color:#f3c9bd;color:#c04426;background:#fff}
.btn-d:hover{background:#fdf0ec;transform:translateY(-1px)}
.btn-ink{background:var(--ink);color:var(--mint)}
.btn-ink:hover{background:var(--pine2);transform:translateY(-2px)}
.btn-sm{padding:7px 13px;font-size:13px;border-radius:8px}
.btn-xs{padding:5px 10px;font-size:12px;border-radius:7px}
.chip{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11.5px;font-weight:500;padding:4px 10px;border-radius:5px;border:1px solid var(--line);background:var(--panel)}
.badge{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:4px}
.b-live{background:#e2f4e9;color:#0f5f3c}
.b-train{background:#fdf0d9;color:#9a6408}
.b-open{background:#e5eefb;color:#2b6cb0}
.b-res{background:#e2f4e9;color:#0f5f3c}
.b-esc{background:#fdeae4;color:#c04426}
.b-free{background:#ecefe9;color:#5f7168}
.b-pro{background:#fdf0d9;color:#9a6408}
.b-scale{background:#e9e4f7;color:#5b3fa8}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.dot-live{background:var(--green);box-shadow:0 0 0 0 rgba(23,126,81,.5);animation:pulse 2s infinite}
.dot-train{background:var(--amber);animation:blink 1.1s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(23,126,81,.45)}70%{box-shadow:0 0 0 7px rgba(23,126,81,0)}100%{box-shadow:0 0 0 0 rgba(23,126,81,0)}}
@keyframes blink{50%{opacity:.25}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh)}
.sec{padding:96px 0}
.wrap{max-width:1180px;margin:0 auto;padding:0 28px}
.sec-head{display:flex;align-items:baseline;gap:22px;margin-bottom:48px;flex-wrap:wrap}
.sec-head .idx{font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:.12em;color:var(--amber-d)}
.sec-head h2{font-size:clamp(1.9rem,3.4vw,2.7rem);font-weight:800;letter-spacing:-.02em;line-height:1.08}
.sec-head .side{margin-left:auto;display:flex;align-items:center;gap:14px}
.inp{width:100%;padding:10px 14px;border:1.5px solid var(--line2);border-radius:8px;background:var(--panel);font-size:14px;transition:border-color .15s,box-shadow .15s}
.inp:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(23,126,81,.14)}
.sel{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235f7168' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:34px}
.ta{resize:vertical;min-height:88px}
.switch{position:relative;width:38px;height:22px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.switch i{position:absolute;inset:0;background:var(--line2);border-radius:99px;transition:.2s}
.switch i::before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.switch input:checked+i{background:var(--green)}
.switch input:checked+i::before{transform:translateX(16px)}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.tbl th{font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);text-align:left;padding:10px 14px;border-bottom:1.5px solid var(--line)}
.tbl td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tbody tr{transition:background .15s}
.tbl tbody tr:hover{background:var(--panel2)}
.avatar{width:34px;height:34px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12.5px;color:#fff;flex-shrink:0;font-family:var(--disp)}
.reveal{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}

#demoNav{position:fixed;left:18px;bottom:18px;z-index:200;display:none;align-items:center;gap:4px;background:var(--ink);color:#cfe8da;border-radius:99px;padding:5px 6px 5px 14px;box-shadow:var(--sh-lg);border:1px solid var(--pine2)}
body.demo-mode #demoNav{display:flex}
#demoNav .dn-label{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--amber);margin-right:8px}
#demoNav button{font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:99px;color:#a9c8b8;transition:.18s}
#demoNav button:hover{color:#fff}
#demoNav button.on{background:var(--green);color:#fff}
#toasts{position:fixed;right:20px;bottom:20px;z-index:300;display:flex;flex-direction:column;gap:10px;align-items:flex-end}
.toast{display:flex;align-items:center;gap:10px;background:var(--ink);color:#e8f4ec;padding:12px 18px;border-radius:10px;font-size:13.5px;font-weight:500;box-shadow:var(--sh-lg);border:1px solid var(--pine2);animation:toastIn .35s cubic-bezier(.2,.9,.3,1.2);max-width:340px}
.toast .ic{color:var(--mint)}
.toast.out{animation:toastOut .3s forwards}
@keyframes toastIn{from{opacity:0;transform:translateY(14px) scale(.95)}}
@keyframes toastOut{to{opacity:0;transform:translateX(20px)}}

.view{display:none}
.view.active{display:block;animation:viewIn .4s ease}
#view-app.active{display:grid}
#view-admin.active{display:grid}
@keyframes viewIn{from{opacity:0;transform:translateY(10px)}}

/* ============ AUTH ============ */
#view-auth.active{display:grid;grid-template-columns:1.05fr 1fr;min-height:100vh}
.auth-left{background:var(--ink);color:#e8f4ec;padding:56px;display:flex;flex-direction:column;position:relative;overflow:hidden}
.auth-left::before{content:"";position:absolute;inset:0;background:radial-gradient(640px 380px at 0% 100%,rgba(23,126,81,.4),transparent 60%);pointer-events:none}
.auth-left::after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(143,227,180,.13) 1px,transparent 1px);background-size:26px 26px;mask-image:radial-gradient(600px 400px at 30% 70%,#000,transparent);pointer-events:none}
.auth-left>*{position:relative;z-index:1}
.auth-left h1{font-size:clamp(2.4rem,4.2vw,3.6rem);font-weight:800;letter-spacing:-.03em;line-height:1.05;margin:60px 0 30px;max-width:480px}
.auth-points{display:flex;flex-direction:column;gap:14px;font-size:15px;color:#bcd9ca}
.auth-points div{display:flex;gap:12px;align-items:center}
.auth-points .ic{color:var(--mint)}
.auth-live{margin-top:auto;font-family:var(--mono);font-size:12px;color:#7fa391;border:1px solid var(--pine2);border-radius:9px;padding:14px 18px;display:flex;gap:10px;align-items:center;max-width:420px}
.auth-live b{color:var(--mint);font-weight:600;transition:.3s}
.auth-quote{margin-top:22px;font-size:13.5px;color:#8fb3a1;max-width:400px;line-height:1.6}
.auth-right{display:flex;align-items:center;justify-content:center;padding:40px 28px;background:var(--paper);position:relative}
.auth-right::before{content:"";position:absolute;inset:0;background-image:radial-gradient(var(--line2) 1px,transparent 1px);background-size:24px 24px;opacity:.5;mask-image:radial-gradient(500px 400px at 50% 45%,#000,transparent)}
.auth-card{position:relative;width:min(420px,100%);background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh-lg);padding:36px}
.auth-card h2{font-size:24px;font-weight:800;letter-spacing:-.02em}
.auth-card .asub{font-size:13.5px;color:var(--mut);margin:6px 0 26px}
.auth-card label{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);display:block;margin:0 0 7px}
.auth-card .inp{margin-bottom:17px}
.auth-div{display:flex;align-items:center;gap:14px;margin:20px 0;color:var(--mut);font-family:var(--mono);font-size:11px}
.auth-div::before,.auth-div::after{content:"";flex:1;height:1px;background:var(--line)}
.auth-fine{margin-top:20px;font-size:11.5px;color:var(--mut);line-height:1.6;text-align:center}
.auth-forgot{font-size:12.5px;color:var(--green-d);font-weight:600;display:inline-block;margin:-8px 0 14px}

/* ============ LANDING ============ */
.lnav{position:sticky;top:0;z-index:100;background:rgba(242,245,238,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.lnav .wrap{display:flex;align-items:center;gap:34px;height:66px}
.logo{display:flex;align-items:center;gap:10px;font-family:var(--disp);font-weight:800;font-size:21px;letter-spacing:-.02em}
.logo-mark{width:32px;height:32px;border-radius:8px;background:var(--green);display:grid;place-items:center;color:#fff;box-shadow:0 4px 10px -3px rgba(23,126,81,.6)}
.lnav .links{display:flex;gap:26px;font-size:14.5px;font-weight:500;color:var(--mut)}
.lnav .links a{transition:color .15s;position:relative}
.lnav .links a:hover{color:var(--green-d)}
.lnav .links a::after{content:"";position:absolute;left:0;bottom:-4px;width:0;height:2px;background:var(--amber);transition:width .2s}
.lnav .links a:hover::after{width:100%}
.lnav .right{margin-left:auto;display:flex;align-items:center;gap:14px}
.lnav .login{font-size:14.5px;font-weight:600;color:var(--mut)}
.lnav .login:hover{color:var(--green-d)}

.hero{position:relative;padding:76px 0 96px;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(720px 420px at 6% -8%,rgba(23,126,81,.12),transparent 60%),radial-gradient(620px 420px at 98% 14%,rgba(242,169,59,.12),transparent 60%)}
.hero::after{content:"";position:absolute;inset:0;background-image:radial-gradient(var(--line2) 1px,transparent 1px);background-size:26px 26px;opacity:.5;mask-image:radial-gradient(900px 560px at 45% 30%,#000 30%,transparent 78%)}
.hero .wrap{position:relative;z-index:2;display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center}
.hero-eyebrow{font-family:var(--mono);font-size:11.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--pine2);display:flex;align-items:center;gap:10px}
.hero-eyebrow .dot{background:var(--green);animation:pulse 2s infinite}
.hero h1{font-size:clamp(2.7rem,5.6vw,4.5rem);font-weight:800;line-height:1.02;letter-spacing:-.03em;margin:24px 0 20px}
.hero h1 .hl{position:relative;display:inline-block;color:var(--green-d)}
.hero h1 .hl svg{position:absolute;left:0;bottom:-8px;width:100%;height:12px}
.hero .sub{font-size:17.5px;line-height:1.65;color:var(--mut);max-width:520px;margin-bottom:30px}
.hero .sub b{color:var(--txt)}
.hero-ctas{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.hero-trust{margin-top:18px;font-family:var(--mono);font-size:11.5px;color:var(--mut);display:flex;gap:16px;flex-wrap:wrap}
.hero-trust span{display:inline-flex;align-items:center;gap:6px}
.hero-trust .ic{color:var(--green)}
.queue{margin-top:36px;background:var(--panel);border:1px solid var(--line);border-radius:11px;box-shadow:var(--sh);max-width:460px;overflow:hidden}
.queue-head{display:flex;align-items:center;gap:9px;padding:10px 16px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.queue-head .dot{background:var(--amber);animation:blink 1.2s infinite}
.queue-head .qstat{margin-left:auto;color:var(--green);display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .4s}
.queue-head .qstat.on{opacity:1}
.q-row{display:flex;align-items:center;gap:12px;padding:11px 16px;font-size:13px}
.q-row+.q-row{border-top:1px dashed var(--line)}
.q-row .q-ic{width:28px;height:28px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);display:grid;place-items:center;color:var(--pine2)}
.q-row .fname{font-family:var(--mono);font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.q-row .pct{font-family:var(--mono);font-size:11px;color:var(--mut);width:40px;text-align:right}
.pbar{height:5px;background:var(--paper);border-radius:99px;overflow:hidden;width:110px;flex-shrink:0}
.pbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--green),var(--mint));border-radius:99px;transition:width .35s ease}
.q-row .ok{color:var(--green);display:inline-flex;opacity:0;transition:opacity .3s}
.q-row.done .ok{opacity:1}
.q-row.done .pbar,.q-row.done .pct{display:none}
.hero-right{position:relative;display:flex;flex-direction:column;align-items:center;gap:14px}
.widget{position:relative;z-index:2;width:min(396px,100%);background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh-lg);overflow:hidden}
.wg-head{display:flex;align-items:center;gap:12px;padding:15px 18px;background:var(--pine);color:#fff}
.wg-ava{width:38px;height:38px;border-radius:9px;display:grid;place-items:center;font-family:var(--disp);font-weight:800;font-size:17px;flex-shrink:0}
.wg-name{font-weight:700;font-size:15px;font-family:var(--disp)}
.wg-sub{font-size:11.5px;color:var(--mint-dim);display:flex;align-items:center;gap:6px}
.wg-sub .dot{width:6px;height:6px;background:var(--mint);animation:pulse 2s infinite}
.wg-tag{margin-left:auto;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;color:var(--mint-dim);border:1px solid rgba(143,227,180,.3);padding:3px 8px;border-radius:4px}
.wg-body{height:330px;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:11px;background:linear-gradient(180deg,#fbfcf8,var(--paper))}
.wg-body::-webkit-scrollbar{width:5px}
.wg-body::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px}
.msg{max-width:84%;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.55;animation:msgIn .3s cubic-bezier(.2,.9,.3,1.15)}
@keyframes msgIn{from{opacity:0;transform:translateY(8px) scale(.97)}}
.msg.bot{background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px;align-self:flex-start;box-shadow:0 2px 6px -2px rgba(13,33,26,.1)}
.msg.user{background:var(--green);color:#fff;border-bottom-right-radius:4px;align-self:flex-end;box-shadow:0 4px 10px -4px rgba(23,126,81,.6)}
.msg.agent{background:#e5eefb;border:1px solid #c9dcf5;border-bottom-left-radius:4px;align-self:flex-start}
.msg .src{display:block;margin-top:7px;font-family:var(--mono);font-size:10px;color:var(--green-d);opacity:.9}
.msg .fb{display:flex;gap:5px;margin-top:8px}
.msg .fb button{display:inline-flex;padding:4px 8px;border-radius:6px;border:1px solid var(--line);background:#fff;transition:.15s;color:var(--mut)}
.msg .fb button:hover{transform:translateY(-1px);border-color:var(--green);color:var(--green-d)}
.msg .fb button.on{background:var(--green);color:#fff;border-color:var(--green)}
.typing{display:inline-flex;gap:4px;padding:14px 16px}
.typing i{width:6px;height:6px;border-radius:50%;background:var(--mut);animation:tp 1s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes tp{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-5px);opacity:1}}
.wg-chips{display:flex;gap:7px;padding:0 14px 11px;flex-wrap:wrap;background:linear-gradient(180deg,#fbfcf8,var(--paper))}
.wg-chips button{font-size:12px;font-weight:600;color:var(--green-d);background:#fff;border:1px solid var(--mint-dim);border-radius:99px;padding:6px 12px;transition:.15s}
.wg-chips button:hover{background:var(--green);color:#fff;transform:translateY(-1px)}
.wg-input{display:flex;gap:9px;padding:13px 14px;border-top:1px solid var(--line);background:var(--panel)}
.wg-input input{flex:1;border:1.5px solid var(--line2);border-radius:9px;padding:10px 14px;font-size:13.5px}
.wg-input input:focus{outline:none;border-color:var(--green)}
.wg-send{width:40px;height:40px;border-radius:9px;background:var(--green);color:#fff;display:grid;place-items:center;transition:.18s;flex-shrink:0}
.wg-send:hover{background:var(--green-d);transform:scale(1.06)}
.wg-foot{font-family:var(--mono);font-size:9.5px;text-align:center;padding:7px;color:var(--mut);background:var(--panel);letter-spacing:.1em}
.ground{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);display:flex;gap:8px;align-items:center}
.ground b{color:var(--green-d);font-weight:600}
.ground .dot{background:var(--green)}

.marquee{background:var(--ink);color:var(--mint-dim);overflow:hidden;border-block:1px solid var(--pine2)}
.mq-track{display:flex;gap:0;width:max-content;animation:mq 30s linear infinite;padding:14px 0}
.marquee:hover .mq-track{animation-play-state:paused}
.mq-track span{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:0 22px;display:flex;align-items:center;gap:22px;white-space:nowrap}
.mq-track b{color:var(--amber);font-weight:400}
@keyframes mq{to{transform:translateX(-50%)}}

.steps{position:relative;max-width:920px}
.steps::before{content:"";position:absolute;left:31px;top:20px;bottom:20px;width:2px;background:repeating-linear-gradient(180deg,var(--line2) 0 7px,transparent 7px 14px)}
.step{display:grid;grid-template-columns:64px 1fr 220px;gap:26px;align-items:center;padding:26px 18px;border-radius:12px;transition:background .2s,transform .2s;position:relative}
.step:hover{background:var(--panel);box-shadow:var(--sh);transform:translateX(6px)}
.step-num{width:64px;height:64px;border-radius:14px;background:var(--pine);color:var(--mint);display:grid;place-items:center;font-family:var(--disp);font-weight:800;font-size:22px;position:relative;z-index:1;border:3px solid var(--paper)}
.step:nth-child(3) .step-num{background:var(--amber);color:var(--ink)}
.step:nth-child(4) .step-num{background:var(--coral);color:#fff}
.step:nth-child(5) .step-num{background:var(--sky);color:#fff}
.step h3{font-size:20px;font-weight:700;letter-spacing:-.01em;margin-bottom:7px}
.step p{font-size:14px;color:var(--mut);line-height:1.6;max-width:480px}
.mini{background:var(--panel2);border:1px dashed var(--line2);border-radius:10px;padding:14px;min-height:76px;display:flex;align-items:center;justify-content:center;gap:9px}
.mini-tiles{display:flex;gap:6px}
.mini-tiles i{font-style:normal;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.06em;background:#fff;border:1px solid var(--line);border-radius:6px;padding:9px 10px;box-shadow:var(--sh);transition:transform .2s;color:var(--pine2)}
.step:hover .mini-tiles i:nth-child(1){transform:translateY(-4px)}
.step:hover .mini-tiles i:nth-child(2){transform:translateY(-7px)}
.step:hover .mini-tiles i:nth-child(3){transform:translateY(-3px)}
.mini-ring{width:40px;height:40px;border-radius:50%;border:4px solid var(--line);border-top-color:var(--green);border-right-color:var(--green);animation:spin 2.4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.mini-code{font-family:var(--mono);font-size:10.5px;color:var(--pine2);line-height:1.7}
.mini-code b{color:var(--coral);font-weight:500}
.mini-fb{display:flex;gap:8px}
.mini-fb button{width:38px;height:38px;border-radius:8px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;color:var(--mut);transition:.18s}
.mini-fb button:hover{transform:translateY(-3px);border-color:var(--green);color:var(--green-d);box-shadow:var(--sh)}

.bento-sec{background:linear-gradient(180deg,var(--paper),#e9efe3)}
.bento{display:grid;grid-template-columns:1.15fr 1.15fr .9fr;grid-template-areas:"a a c" "a a c" "b d c";gap:20px}
.bcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px;box-shadow:var(--sh);position:relative;overflow:hidden;transition:transform .25s,border-color .25s,box-shadow .25s}
.bcard:hover{transform:translateY(-5px);box-shadow:var(--sh-lg);border-color:var(--mint-dim)}
.bcard h3{font-size:21px;font-weight:700;letter-spacing:-.01em;margin-bottom:8px}
.bcard>p{font-size:13.5px;color:var(--mut);line-height:1.55;max-width:400px}
.b-a{grid-area:a}.b-c{grid-area:c}.b-b{grid-area:b}.b-d{grid-area:d}
.b-a .mock{margin-top:22px;display:flex;flex-direction:column;gap:9px}
.mock-row{display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);transition:transform .2s,border-color .2s;cursor:pointer}
.mock-row:hover{transform:translateX(6px);border-color:var(--green);background:#fff}
.mock-row .mtxt{flex:1;min-width:0}
.mock-row .mtxt b{font-size:13px;display:block}
.mock-row .mtxt span{font-size:12px;color:var(--mut);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mock-row time{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.b-a .go{display:inline-flex;align-items:center;gap:7px;margin-top:18px;font-weight:600;font-size:13.5px;color:var(--green-d)}
.b-a .go .ic{transition:transform .18s}
.b-a .go:hover .ic{transform:translateX(4px)}
.b-c{display:flex;flex-direction:column}
.b-c .bigstat{font-family:var(--disp);font-weight:800;font-size:44px;letter-spacing:-.03em;margin:14px 0 2px;color:var(--green-d)}
.b-c .bigstat small{font-size:16px;color:var(--mut);font-weight:600}
.b-c .chartbox{margin-top:auto;padding-top:16px}
.b-c .chartbox svg{width:100%;height:88px;display:block}
.drawline{stroke-dasharray:600;stroke-dashoffset:600;transition:stroke-dashoffset 1.8s ease .3s}
.in .drawline{stroke-dashoffset:0}
.b-b .swatches{display:flex;gap:10px;margin-top:18px}
.b-b .swatches button{width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1.5px var(--line2),var(--sh);transition:transform .18s}
.b-b .swatches button:hover{transform:scale(1.2)}
.b-b .miniwg{margin-top:16px;border-radius:11px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--sh)}
.b-b .miniwg .mh{padding:10px 14px;color:#fff;font-size:12.5px;font-weight:700;display:flex;gap:9px;align-items:center;transition:background .3s}
.b-b .miniwg .mh i{font-style:normal;background:rgba(255,255,255,.2);width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-family:var(--disp);font-size:11px}
.b-b .miniwg .mb{padding:10px 12px;background:#fff;font-size:11.5px;color:var(--mut)}
.b-d .handoff{margin-top:18px;background:#fff;border:1px solid var(--line);border-left:4px solid var(--sky);border-radius:9px;padding:13px 14px;box-shadow:var(--sh);transform:translateX(-8px);opacity:.85;transition:.3s}
.bcard.b-d:hover .handoff{transform:none;opacity:1}
.handoff b{font-size:12.5px;display:flex;gap:8px;align-items:center}
.handoff b .ic{color:var(--sky)}
.handoff p{font-size:12px;color:var(--mut);margin-top:5px;line-height:1.5}
.handoff .acts{display:flex;gap:8px;margin-top:10px}
.handoff .acts button{font-size:11px;font-weight:700;padding:5px 11px;border-radius:6px;background:var(--sky);color:#fff;transition:.15s}
.handoff .acts button:last-child{background:#fff;color:var(--txt);border:1px solid var(--line)}
.handoff .acts button:hover{transform:translateY(-1px)}
.b-wide{margin-top:20px;display:flex;align-items:center;gap:34px;flex-wrap:wrap}
.b-wide .globewrap{width:74px;height:74px;border-radius:50%;background:var(--pine);color:var(--mint);display:grid;place-items:center;flex-shrink:0;animation:spin 26s linear infinite}
.langs{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.langs span{font-family:var(--mono);font-size:11px;padding:5px 11px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);transition:.15s;cursor:default}
.langs span:hover{background:var(--green);color:#fff;transform:translateY(-2px)}

.proof{background:var(--ink);color:#e8f4ec;position:relative;overflow:hidden}
.proof::before{content:"";position:absolute;inset:0;background:radial-gradient(700px 340px at 85% 0%,rgba(23,126,81,.35),transparent 65%),radial-gradient(500px 300px at 5% 100%,rgba(242,169,59,.12),transparent 60%)}
.proof .wrap{position:relative}
.proof-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:34px;padding:10px 0 60px;border-bottom:1px solid var(--pine2)}
.pstat .num{font-family:var(--disp);font-weight:800;font-size:clamp(2.4rem,4.4vw,3.6rem);letter-spacing:-.03em;color:var(--mint)}
.pstat:nth-child(2) .num{color:var(--amber)}
.pstat:nth-child(3) .num{color:#fff}
.pstat:nth-child(4) .num{color:var(--coral)}
.pstat .lbl{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#8fb3a1;margin-top:6px}
.quote{display:flex;gap:26px;align-items:flex-start;padding:56px 0 8px;max-width:820px}
.quote .qmark{font-family:var(--disp);font-size:88px;line-height:.6;color:var(--amber);flex-shrink:0;margin-top:18px}
.quote blockquote{font-family:var(--disp);font-size:clamp(1.35rem,2.4vw,1.85rem);font-weight:600;line-height:1.4;letter-spacing:-.01em}
.quote .who{display:flex;align-items:center;gap:13px;margin-top:22px}
.quote .who b{display:block;font-size:14.5px}
.quote .who span{font-size:12.5px;color:#8fb3a1}

.bill-toggle{display:inline-flex;align-items:center;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:4px;box-shadow:var(--sh)}
.bill-toggle button{font-size:13px;font-weight:600;padding:7px 16px;border-radius:6px;color:var(--mut);transition:.2s}
.bill-toggle button.on{background:var(--ink);color:var(--mint)}
.bill-toggle .save{font-family:var(--mono);font-size:10px;color:var(--amber-d);font-weight:600;margin-left:6px}
.plans{display:grid;grid-template-columns:1fr 1.25fr 1fr;gap:22px;align-items:center}
.plan{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:30px;box-shadow:var(--sh);transition:transform .25s,box-shadow .25s}
.plan:hover{transform:translateY(-6px);box-shadow:var(--sh-lg)}
.plan .pname{font-family:var(--disp);font-weight:700;font-size:19px}
.plan .pfor{font-size:13px;color:var(--mut);margin-top:3px}
.plan .price{font-family:var(--disp);font-weight:800;font-size:46px;letter-spacing:-.03em;margin:18px 0 4px}
.plan .price small{font-size:15px;font-weight:600;color:var(--mut);letter-spacing:0}
.plan .per{font-family:var(--mono);font-size:11px;color:var(--mut)}
.plan ul{list-style:none;margin:22px 0 26px;display:flex;flex-direction:column;gap:11px}
.plan li{display:flex;gap:10px;font-size:13.5px;align-items:flex-start;line-height:1.45}
.plan li .ic{color:var(--green);margin-top:2px}
.plan .btn{width:100%;justify-content:center}
.plan-feat{border:2px solid var(--amber);position:relative;padding:38px 32px;box-shadow:var(--sh-lg)}
.plan-feat .tag{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:var(--amber);color:var(--ink);font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.12em;padding:5px 15px;border-radius:4px;white-space:nowrap}
.plan-feat .price{color:var(--green-d)}
.price-note{text-align:center;margin-top:26px;font-family:var(--mono);font-size:11.5px;color:var(--mut)}

.faq-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:60px;align-items:start}
.faq-left{position:sticky;top:100px}
.faq-left h2{font-size:clamp(1.9rem,3.2vw,2.6rem);font-weight:800;letter-spacing:-.02em;line-height:1.1}
.faq-left p{color:var(--mut);margin-top:14px;line-height:1.6;font-size:15px}
.faq-item{border-bottom:1.5px solid var(--line)}
.faq-item button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 4px;text-align:left;font-family:var(--disp);font-size:17.5px;font-weight:600;letter-spacing:-.01em;transition:color .15s}
.faq-item button:hover{color:var(--green-d)}
.faq-item .pm{width:30px;height:30px;border-radius:7px;border:1.5px solid var(--line2);display:grid;place-items:center;flex-shrink:0;transition:.25s;color:var(--mut)}
.faq-item.open .pm{background:var(--green);border-color:var(--green);color:#fff;transform:rotate(45deg)}
.faq-a{max-height:0;overflow:hidden;transition:max-height .35s ease}
.faq-a p{padding:0 44px 22px 4px;color:var(--mut);font-size:14.5px;line-height:1.7}

.cta-band{background:var(--green);color:#fff;position:relative;overflow:hidden;border-radius:18px;margin:0 28px 90px;padding:80px 40px;text-align:center}
.cta-band::before{content:"";position:absolute;inset:0;background:radial-gradient(500px 260px at 20% 0%,rgba(255,255,255,.16),transparent 60%),radial-gradient(400px 240px at 90% 100%,rgba(13,33,26,.28),transparent 60%)}
.cta-band .wm{position:absolute;left:50%;bottom:-42px;transform:translateX(-50%);font-family:var(--disp);font-weight:800;font-size:190px;letter-spacing:-.04em;color:transparent;-webkit-text-stroke:1.5px rgba(255,255,255,.16);pointer-events:none;white-space:nowrap}
.cta-band h2{position:relative;font-size:clamp(2rem,4vw,3.1rem);font-weight:800;letter-spacing:-.02em}
.cta-band p{position:relative;margin:14px auto 30px;max-width:440px;color:#d9efe3;font-size:16px}
.cta-band .btn{position:relative;background:var(--ink);color:var(--mint);font-size:16px;padding:15px 30px}
.cta-band .btn:hover{background:#000;transform:translateY(-3px)}
footer{background:var(--ink);color:#a9c8b8;padding:64px 0 34px}
.foot-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:40px;padding-bottom:44px;border-bottom:1px solid var(--pine2)}
.foot-grid h4{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6f9482;margin-bottom:16px}
.foot-grid a{display:block;font-size:14px;padding:5px 0;transition:color .15s,transform .15s;cursor:pointer}
.foot-grid a:hover{color:var(--mint);transform:translateX(3px)}
.foot-brand p{font-size:13.5px;line-height:1.6;max-width:280px;margin-top:14px;color:#7fa391}
.foot-status{display:inline-flex;align-items:center;gap:8px;margin-top:18px;font-family:var(--mono);font-size:11.5px;color:var(--mint);border:1px solid var(--pine2);padding:7px 14px;border-radius:99px;transition:.2s;cursor:pointer}
.foot-status:hover{border-color:var(--green);background:rgba(23,126,81,.15)}
.foot-bottom{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-top:26px;font-family:var(--mono);font-size:11.5px;color:#5f8471}

/* ============ APP SHELL ============ */
#view-app{grid-template-columns:250px 1fr;min-height:100vh;background:var(--paper)}
.app-side{background:var(--pine);color:#cfe8da;display:flex;flex-direction:column;padding:18px 14px;position:sticky;top:0;height:100vh}
.ws-switch{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;background:var(--pine2);border:1px solid rgba(143,227,180,.14);cursor:pointer;transition:.18s;margin-bottom:22px}
.ws-switch:hover{background:var(--pine3)}
.ws-ava{width:34px;height:34px;border-radius:8px;background:var(--amber);color:var(--ink);display:grid;place-items:center;font-family:var(--disp);font-weight:800;font-size:15px}
.ws-switch b{font-size:14px;display:block;color:#fff}
.ws-switch span{font-size:11px;color:#8fb3a1}
.app-nav{display:flex;flex-direction:column;gap:3px;flex:1}
.nav-sec{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#6f9482;padding:14px 12px 7px}
.nav-it{display:flex;align-items:center;gap:11px;padding:9.5px 12px;border-radius:8px;font-size:14px;font-weight:500;color:#a9c8b8;transition:.16s;cursor:pointer;border-left:3px solid transparent;text-align:left;width:100%}
.nav-it:hover{background:rgba(143,227,180,.09);color:#fff;transform:translateX(2px)}
.nav-it.on{background:rgba(143,227,180,.13);color:var(--mint);border-left-color:var(--amber);font-weight:600}
.nav-it .cnt{margin-left:auto;font-family:var(--mono);font-size:10.5px;background:var(--pine3);padding:2px 8px;border-radius:99px}
.usage{background:var(--pine2);border:1px solid rgba(143,227,180,.14);border-radius:10px;padding:14px;margin:14px 0}
.usage .ul{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10.5px;color:#8fb3a1;margin-bottom:8px}
.usage .ul b{color:var(--mint)}
.usage .pbar{width:100%;background:var(--pine3)}
.usage .pbar i{width:42%;animation:none;background:linear-gradient(90deg,var(--green),var(--mint))}
.usage a{display:block;margin-top:9px;font-size:11.5px;font-weight:600;color:var(--amber);cursor:pointer}
.user-chip{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;transition:.15s;cursor:pointer;position:relative}
.user-chip:hover{background:rgba(143,227,180,.09)}
.user-chip b{font-size:13px;display:block;color:#fff}
.user-chip span{font-size:11px;color:#8fb3a1}
.user-menu{position:absolute;bottom:52px;left:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:var(--sh-lg);padding:6px;display:none;width:190px;z-index:80}
.user-menu.open{display:block;animation:msgIn .2s}
.user-menu button{display:flex;gap:9px;align-items:center;width:100%;padding:9px 11px;border-radius:7px;font-size:13px;font-weight:500;color:var(--txt);transition:.13s}
.user-menu button:hover{background:var(--panel2)}
.app-main{display:flex;flex-direction:column;min-width:0}
.app-top{position:sticky;top:0;z-index:50;background:rgba(242,245,238,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 30px;height:64px}
.app-top h2{font-size:19px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.top-search{position:relative;flex:1;max-width:420px;margin-left:8px}
.top-search .ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--mut)}
.top-search input{width:100%;padding:9px 14px 9px 38px;border:1.5px solid var(--line2);border-radius:9px;background:var(--panel);font-size:13.5px}
.top-search input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(23,126,81,.13)}
.top-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.bell{position:relative;width:38px;height:38px;border-radius:9px;border:1.5px solid var(--line2);background:var(--panel);display:grid;place-items:center;transition:.15s;color:var(--mut)}
.bell:hover{border-color:var(--green);color:var(--green-d);transform:translateY(-1px)}
.bell .bdg{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;border-radius:50%;background:var(--coral);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;border:2px solid var(--paper)}
.bell-drop{position:absolute;right:0;top:48px;width:330px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh-lg);padding:8px;display:none;z-index:60;animation:msgIn .25s}
.bell-drop.open{display:block}
.bell-drop .bh{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;font-weight:700;font-size:14px}
.bell-drop .bh button{font-size:11.5px;color:var(--green-d);font-weight:600}
.notif{display:flex;gap:11px;padding:11px 10px;border-radius:8px;font-size:13px;transition:.15s;cursor:pointer}
.notif:hover{background:var(--panel2)}
.notif .nd{width:8px;height:8px;border-radius:50%;background:var(--amber);margin-top:5px;flex-shrink:0}
.notif.read .nd{background:var(--line2)}
.notif time{display:block;font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:3px}
.app-content{padding:28px 30px 60px;flex:1}
.panel{display:none}
.panel.on{display:block;animation:viewIn .35s ease}
.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:24px}
.panel-head h3{font-size:24px;font-weight:800;letter-spacing:-.02em}
.panel-head .ph-sub{color:var(--mut);font-size:13.5px;margin-top:4px}
.ph-actions{display:flex;gap:10px;flex-wrap:wrap}

.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:var(--sh);transition:transform .2s,border-color .2s}
.stat:hover{transform:translateY(-3px);border-color:var(--mint-dim)}
.stat .sl{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.stat .sv{font-family:var(--disp);font-weight:800;font-size:30px;letter-spacing:-.02em;margin:7px 0 3px}
.stat .sd{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px}
.sd.up{background:#e2f4e9;color:#0f5f3c}
.sd.down{background:#fdeae4;color:#c04426}
.stat .spark{margin-top:10px;display:block}
.stat .spark svg{width:100%;height:34px;display:block}
.ov-grid{display:grid;grid-template-columns:1.7fr 1fr;gap:16px;margin-bottom:20px}
.chart-card{padding:20px}
.chart-card .ch{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.chart-card .ch b{font-size:15.5px;font-weight:700}
.rtabs{display:flex;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:3px}
.rtabs button{font-family:var(--mono);font-size:11px;font-weight:600;padding:5px 12px;border-radius:6px;color:var(--mut);transition:.15s}
.rtabs button.on{background:var(--ink);color:var(--mint)}
.ovchart{position:relative;height:210px}
.ovchart svg{width:100%;height:100%;display:block}
.ov-vline{position:absolute;top:0;bottom:22px;width:1.5px;background:var(--green);opacity:0;pointer-events:none}
.ov-tip{position:absolute;background:var(--ink);color:var(--mint);font-family:var(--mono);font-size:11px;padding:6px 10px;border-radius:7px;pointer-events:none;opacity:0;transform:translate(-50%,-115%);white-space:nowrap;transition:opacity .12s}
.ov-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--green);border:2px solid #fff;pointer-events:none;opacity:0;transform:translate(-50%,-50%);box-shadow:var(--sh)}
.legend{display:flex;gap:16px;font-family:var(--mono);font-size:11px;color:var(--mut)}
.legend i{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:6px}
.bot-mini{display:flex;align-items:center;gap:13px;padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--panel);transition:.18s;cursor:pointer}
.bot-mini:hover{border-color:var(--green);transform:translateX(4px);box-shadow:var(--sh)}
.bot-mini+.bot-mini{margin-top:10px}
.bot-ava{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;font-family:var(--disp);font-weight:800;font-size:17px;flex-shrink:0;color:#fff}
.bot-mini b{font-size:14px;display:flex;align-items:center;gap:8px}
.bot-mini span{font-size:12px;color:var(--mut)}
.bot-mini .bm-r{margin-left:auto;text-align:right;font-family:var(--mono);font-size:11px;color:var(--mut)}
.bot-mini .bm-r b{font-family:var(--disp);font-size:17px;justify-content:flex-end}
.rc-row{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px dashed var(--line);cursor:pointer;transition:.15s;border-radius:8px}
.rc-row:hover{background:var(--panel2);padding-left:12px}
.rc-row:last-child{border-bottom:none}
.rc-row .rt{flex:1;min-width:0}
.rc-row b{font-size:13.5px;display:block}
.rc-row span{font-size:12px;color:var(--mut);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc-row time{font-family:var(--mono);font-size:10.5px;color:var(--mut)}

.bot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}
.bot-card{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:22px;box-shadow:var(--sh);transition:transform .22s,box-shadow .22s,border-color .22s;position:relative}
.bot-card:hover{transform:translateY(-5px);box-shadow:var(--sh-lg);border-color:var(--mint-dim)}
.bot-card .bc-top{display:flex;gap:13px;align-items:center;margin-bottom:12px}
.bot-card h4{font-size:17px;font-weight:700;font-family:var(--disp)}
.bot-card .bc-desc{font-size:13px;color:var(--mut);line-height:1.55;min-height:40px}
.bc-stats{display:flex;gap:0;margin:16px 0;border-block:1px solid var(--line);padding:11px 0}
.bc-stats div{flex:1;text-align:center}
.bc-stats div+div{border-left:1px solid var(--line)}
.bc-stats b{font-family:var(--disp);font-size:16.5px;display:block}
.bc-stats span{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
.bc-foot{display:flex;gap:9px}
.bc-foot .btn{flex:1;justify-content:center}
.bot-new{border:2px dashed var(--line2);background:transparent;box-shadow:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:230px;color:var(--mut);transition:.2s;cursor:pointer}
.bot-new:hover{border-color:var(--green);color:var(--green-d);background:rgba(23,126,81,.05);transform:translateY(-4px)}
.bot-new .plus{width:52px;height:52px;border-radius:13px;background:var(--panel);border:1.5px solid var(--line2);display:grid;place-items:center;transition:.25s}
.bot-new:hover .plus{background:var(--green);color:#fff;border-color:var(--green);transform:rotate(90deg)}
.train-bar{margin-top:14px}
.train-bar .pbar{width:100%}
.train-bar .pbar i{transition:width .8s ease}
.train-bar span{font-family:var(--mono);font-size:10.5px;color:var(--amber-d);display:block;margin-top:6px}

.bd-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.bd-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--mut);transition:.15s}
.bd-back:hover{color:var(--green-d);transform:translateX(-3px)}
.bd-id{display:flex;align-items:center;gap:14px;flex:1}
.bd-id .bot-ava{width:50px;height:50px;font-size:21px;border-radius:13px}
.bd-id h3{font-size:22px;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.bd-id p{font-size:13px;color:var(--mut)}
.bd-tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin-bottom:24px;overflow-x:auto}
.bd-tabs button{font-size:14px;font-weight:600;color:var(--mut);padding:11px 18px;border-bottom:2.5px solid transparent;margin-bottom:-2px;transition:.15s;display:flex;gap:8px;align-items:center;white-space:nowrap}
.bd-tabs button:hover{color:var(--green-d)}
.bd-tabs button.on{color:var(--green-d);border-bottom-color:var(--green)}
.tabpane{display:none}
.tabpane.on{display:block;animation:viewIn .3s}
.two-col{display:grid;grid-template-columns:1.25fr .95fr;gap:20px;align-items:start}
.src-item{display:flex;align-items:center;gap:13px;padding:13px 15px;border:1px solid var(--line);border-radius:10px;background:var(--panel);transition:.15s}
.src-item:hover{border-color:var(--mint-dim);box-shadow:var(--sh)}
.src-item+.src-item{margin-top:9px}
.src-ic{width:38px;height:38px;border-radius:8px;display:grid;place-items:center;flex-shrink:0}
.src-ic.pdf{background:#fdeae4;color:#c04426}.src-ic.url{background:#e5eefb;color:#2b6cb0}.src-ic.notion{background:#ecefe9;color:#3d4a43}.src-ic.doc{background:#e5eefb;color:#2b6cb0}.src-ic.txt{background:#fdf0d9;color:#9a6408}.src-ic.qa{background:#fdf0d9;color:#9a6408}
.bot-ava,.wg-ava{overflow:hidden}.bot-ava img,.wg-ava img{width:100%;height:100%;object-fit:contain;background:#fff}
.crawl-box{padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);margin-bottom:14px}
.crawl-box label{display:block;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.crawl-row{display:grid;grid-template-columns:minmax(0,1fr) 82px auto;gap:8px}
.crawl-row .inp{background:#fff}
.crawl-status{display:none;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--mut)}
.crawl-status.on{display:flex}
.crawl-status .spin{width:13px;height:13px;border:2px solid var(--line2);border-top-color:var(--green);border-radius:50%;animation:spin .75s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.src-item .st{flex:1;min-width:0}
.src-item .st b{font-size:13.5px;display:block;font-family:var(--mono);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src-item .st span{font-size:11.5px;color:var(--mut)}
.src-item .rm{color:var(--mut);width:30px;height:30px;border-radius:7px;display:grid;place-items:center;transition:.15s}
.src-item .rm:hover{background:#fdeae4;color:#c04426}
.add-src{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap}
.add-src .inp{flex:1;min-width:160px}
.qa-item{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px 16px;transition:.15s}
.qa-item:hover{border-color:var(--mint-dim)}
.qa-item+.qa-item{margin-top:9px}
.qa-item .q{font-weight:600;font-size:13.5px;display:flex;gap:9px;align-items:flex-start}
.qa-item .q .qtag{font-family:var(--mono);font-size:9px;letter-spacing:.08em;background:#fdf0d9;color:#9a6408;padding:3px 7px;border-radius:4px;margin-top:1px;flex-shrink:0}
.qa-item .a{font-size:13px;color:var(--mut);margin-top:7px;line-height:1.55;padding-left:2px}
.qa-item .qa-foot{display:flex;justify-content:flex-end;margin-top:8px}
.ap-form{display:flex;flex-direction:column;gap:16px}
.ap-form label,.mfield label{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);display:block;margin-bottom:7px}
.color-row{display:flex;gap:9px;align-items:center}
.color-row input[type=color]{width:42px;height:42px;border:1.5px solid var(--line2);border-radius:9px;padding:3px;background:var(--panel);cursor:pointer}
.swb{width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1.5px var(--line2);transition:.15s}
.swb:hover{transform:scale(1.18)}
.pv-wrap{position:sticky;top:88px}
.pv-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.pv-label .dot{background:var(--coral);animation:blink 1.4s infinite}
.code-block{background:var(--ink);color:var(--mint);border-radius:11px;padding:20px 22px;font-family:var(--mono);font-size:12.5px;line-height:1.8;position:relative;overflow-x:auto;border:1px solid var(--pine2)}
.code-block .at{color:var(--amber)}
.code-block .copy{position:absolute;top:12px;right:12px;background:var(--pine2);color:var(--mint);border:1px solid var(--pine3);border-radius:7px;padding:7px 12px;font-size:11.5px;font-weight:600;display:flex;gap:7px;align-items:center;transition:.15s}
.code-block .copy:hover{background:var(--green);color:#fff}
.steps-list{display:flex;flex-direction:column;gap:13px;margin-bottom:22px}
.steps-list li{display:flex;gap:13px;align-items:flex-start;list-style:none;font-size:14px;line-height:1.5}
.steps-list .n{width:26px;height:26px;border-radius:7px;background:var(--pine);color:var(--mint);font-family:var(--disp);font-weight:700;font-size:13px;display:grid;place-items:center;flex-shrink:0}
.tgl-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.tgl-row+.tgl-row{margin-top:9px}
.tgl-row b{font-size:14px;display:block}
.tgl-row span{font-size:12px;color:var(--mut)}
.lock{font-family:var(--mono);font-size:10px;color:var(--amber-d);background:#fdf0d9;padding:2px 8px;border-radius:4px;margin-left:8px}

.conv-grid{display:grid;grid-template-columns:340px 1fr;gap:18px;align-items:start}
.conv-list-card{overflow:hidden}
.cf-tabs{display:flex;gap:4px;padding:12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.cf-tabs button{font-size:12px;font-weight:600;padding:6px 13px;border-radius:99px;color:var(--mut);border:1px solid transparent;transition:.15s}
.cf-tabs button:hover{background:var(--panel2)}
.cf-tabs button.on{background:var(--pine);color:var(--mint)}
.conv-scroll{max-height:560px;overflow-y:auto}
.conv-scroll::-webkit-scrollbar{width:5px}
.conv-scroll::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px}
.cv-row{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);cursor:pointer;transition:.15s;border-left:3px solid transparent}
.cv-row:hover{background:var(--panel2)}
.cv-row.on{background:#eef6ef;border-left-color:var(--green)}
.cv-row .cvt{flex:1;min-width:0}
.cv-row b{font-size:13.5px;display:flex;justify-content:space-between;gap:8px}
.cv-row b time{font-family:var(--mono);font-size:10px;color:var(--mut);font-weight:400}
.cv-row .prev{font-size:12px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px}
.cv-row .meta{display:flex;gap:6px;margin-top:7px;align-items:center}
.thread-card{display:flex;flex-direction:column;min-height:520px}
.thread-head{display:flex;align-items:center;gap:13px;padding:16px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.thread-head b{font-size:15.5px}
.thread-head .meta{font-size:12px;color:var(--mut)}
.thread-head .thr-acts{margin-left:auto;display:flex;gap:9px;align-items:center}
.thread-body{flex:1;padding:22px 20px;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,#fbfcf8,var(--paper));max-height:430px;overflow-y:auto}
.thread-foot{display:flex;gap:10px;padding:14px 16px;border-top:1px solid var(--line)}
.thread-foot input{flex:1}

.an-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px}
.donut-wrap{display:flex;align-items:center;gap:26px;flex-wrap:wrap;justify-content:center}
.donut-c{position:relative}
.donut-c .dc-mid{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.donut-c .dc-mid b{font-family:var(--disp);font-size:26px;display:block}
.donut-c .dc-mid span{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.dlegend{display:flex;flex-direction:column;gap:11px}
.dlegend div{display:flex;align-items:center;gap:10px;font-size:13px}
.dlegend i{width:11px;height:11px;border-radius:4px}
.dlegend b{margin-left:auto;font-family:var(--disp);padding-left:18px}
.tq-trend{display:inline-block;vertical-align:middle}
.tq-trend svg{width:64px;height:20px;display:block}

.modal{position:fixed;inset:0;z-index:250;background:rgba(13,33,26,.55);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:20px}
.modal.open{display:flex;animation:viewIn .25s}
.modal-card{background:var(--panel);border-radius:16px;width:min(540px,100%);padding:28px;box-shadow:var(--sh-lg);animation:modalPop .35s cubic-bezier(.2,.9,.3,1.15);max-height:90vh;overflow-y:auto}
@keyframes modalPop{from{opacity:0;transform:translateY(24px) scale(.96)}}
.modal-card h3{font-size:21px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px}
.modal-card .msub{font-size:13.5px;color:var(--mut);margin-bottom:22px}
.mfield{margin-bottom:17px}
.msrcs{display:flex;flex-direction:column;gap:8px;max-height:170px;overflow-y:auto}
.msrc{display:flex;align-items:center;gap:11px;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px;cursor:pointer;transition:.15s;font-size:13px}
.msrc:hover{border-color:var(--mint-dim)}
.msrc input{accent-color:var(--green);width:16px;height:16px}
.msrc.on{border-color:var(--green);background:#eef6ef}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}

#view-admin{grid-template-columns:240px 1fr;min-height:100vh;background:#0a1510;color:#e6f2ea;--panel:#101f18;--panel2:#152820;--line:#1e3329;--line2:#2a4636;--txt:#e6f2ea;--mut:#8aa396;--sh:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6)}
#view-admin .app-side{background:#0c1a13;border-right:1px solid var(--line)}
#view-admin .app-top{background:rgba(10,21,16,.9);border-bottom-color:var(--line)}
#view-admin .top-search input{background:var(--panel);border-color:var(--line2);color:var(--txt)}
.adm-badge{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;color:var(--amber);border:1px solid rgba(242,169,59,.4);padding:4px 10px;border-radius:4px}
.astat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;transition:.2s}
.astat:hover{transform:translateY(-3px);border-color:var(--line2)}
.astat .sl{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.astat .sv{font-family:var(--disp);font-weight:800;font-size:31px;letter-spacing:-.02em;margin-top:7px;color:var(--mint)}
.astat:nth-child(2) .sv{color:var(--amber)}
.astat:nth-child(3) .sv{color:#fff}
.astat:nth-child(4) .sv{color:var(--coral)}
.astat .sd2{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:5px;display:block}
.astat .sd2 b{color:var(--mint);font-weight:500}
.ticker{display:flex;align-items:center;gap:11px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 16px;font-family:var(--mono);font-size:12px;color:var(--mint-dim);overflow:hidden}
.ticker .live{color:var(--coral);font-weight:600;letter-spacing:.12em;display:flex;gap:7px;align-items:center;flex-shrink:0}
.ticker .live .dot{background:var(--coral);animation:blink 1s infinite}
#tickText{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .3s}
.svc{display:flex;align-items:center;gap:16px;padding:15px 18px;border:1px solid var(--line);border-radius:11px;background:var(--panel);flex-wrap:wrap}
.svc+.svc{margin-top:10px}
.svc b{font-size:14.5px;display:flex;align-items:center;gap:10px;min-width:190px}
.svc .upbars{display:flex;gap:2.5px;flex:1;min-width:160px}
.svc .upbars i{flex:1;height:22px;border-radius:2px;background:var(--green);opacity:.85;transition:.15s}
.svc .upbars i:hover{opacity:1;transform:scaleY(1.15)}
.svc .upbars i.w{background:var(--amber)}
.svc .lat{font-family:var(--mono);font-size:12px;color:var(--mut);width:86px;text-align:right}
.svc .lat b{color:var(--mint);font-size:12px;min-width:0}
#logFeed{background:#07110c;border:1px solid var(--line);border-radius:12px;padding:18px 20px;font-family:var(--mono);font-size:12px;line-height:2;height:430px;overflow-y:auto}
#logFeed::-webkit-scrollbar{width:6px}
#logFeed::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px}
.log-line{display:flex;gap:14px;animation:msgIn .3s;white-space:nowrap}
.log-line time{color:#547a67;flex-shrink:0}
.log-line .lv{width:44px;flex-shrink:0;font-weight:600}
.lv.info{color:var(--mint)}.lv.warn{color:var(--amber)}.lv.err{color:var(--coral)}
.log-line .lm{color:#b9d4c5;overflow:hidden;text-overflow:ellipsis}
.lf-chips{display:flex;gap:7px}
.lf-chips button{font-family:var(--mono);font-size:11px;padding:5px 13px;border-radius:99px;border:1px solid var(--line2);color:var(--mut);transition:.15s}
.lf-chips button.on{background:var(--mint);color:var(--ink);border-color:var(--mint);font-weight:600}
.row-susp{opacity:.45}
.inv-paid{color:var(--mint)}.inv-due{color:var(--amber)}

@media(max-width:1080px){
  .hero .wrap{grid-template-columns:1fr;gap:64px}
  .bento{grid-template-columns:1fr 1fr;grid-template-areas:"a a" "c c" "b d"}
  .plans{grid-template-columns:1fr;max-width:520px;margin-inline:auto}
  .plan-feat{order:-1}
  .faq-grid{grid-template-columns:1fr;gap:34px}
  .faq-left{position:static}
  .stat-grid{grid-template-columns:1fr 1fr}
  .ov-grid,.an-grid,.two-col,.conv-grid{grid-template-columns:1fr}
  .foot-grid{grid-template-columns:1fr 1fr}
  .proof-stats{grid-template-columns:1fr 1fr;gap:26px}
  #view-auth.active{grid-template-columns:1fr}
  .auth-left{display:none}
}
@media(max-width:880px){
  #view-app,#view-admin{grid-template-columns:1fr}
  .app-side{position:fixed;bottom:0;left:0;right:0;top:auto;height:62px;flex-direction:row;align-items:center;padding:0 10px;z-index:120;border-top:1px solid var(--pine2);overflow-x:auto}
  .ws-switch,.usage,.user-chip,.nav-sec{display:none}
  .app-nav{flex-direction:row;gap:4px;flex:1}
  .nav-it{flex-direction:column;gap:3px;font-size:9.5px;padding:7px 11px;border-left:none;border-top:2.5px solid transparent;border-radius:8px}
  .nav-it.on{border-top-color:var(--amber)}
  .nav-it .cnt{display:none}
  .app-content{padding:22px 16px 110px}
  .app-top{padding:0 16px}
  .app-top h2{font-size:16px}
  .lnav .links{display:none}
  .step{grid-template-columns:52px 1fr;gap:18px}
  .step .mini{display:none}
  .step-num{width:52px;height:52px;font-size:18px}
  .steps::before{left:25px}
  .bento{grid-template-columns:1fr;grid-template-areas:"a" "c" "b" "d"}
  .sec{padding:64px 0}
  #demoNav{left:12px;bottom:76px}
  .cta-band{margin:0 14px 60px}
  .cta-band .wm{font-size:110px}
}
@media(max-width:560px){
  .wrap{padding-inline:20px}
  .lnav .wrap{gap:12px}
  .lnav .right{gap:8px}
  .lnav .login{display:none}
  .lnav .right .btn{padding-inline:12px}
  .stat-grid{grid-template-columns:1fr}
  .hero{padding-top:44px}
  .hero .wrap>*{min-width:0}
  .hero h1{font-size:clamp(2.45rem,12vw,3.15rem)}
  .hero h1 .hl{display:inline;background-image:linear-gradient(var(--amber),var(--amber));background-position:0 100%;background-repeat:no-repeat;background-size:100% 4px}
  .hero h1 .hl svg{display:none}
  .hero-ctas{display:grid;grid-template-columns:1fr}
  .hero-ctas .btn{justify-content:center;width:100%}
  .hero-trust{gap:10px 14px}
  .queue .pbar{width:76px}
  .q-row{padding-inline:12px}
  .top-search{display:none}
  .crawl-row{grid-template-columns:1fr 76px}
  .crawl-row .btn{grid-column:1/-1;justify-content:center}
}
</style>
</head>
<body>

<div id="demoNav">
  <span class="dn-label">DEMO</span>
  <button data-view="landing" class="on">Site</button>
  <button data-view="app">Client app</button>
  <button data-view="admin">Admin</button>
</div>
<div id="toasts"></div>

<!-- ==================== AUTH ==================== -->
<div id="view-auth" class="view">
  <div class="auth-left">
    <a class="logo" style="color:#fff"><span class="logo-mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.4-3A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14.5h3.5"/></svg></span> Docent</a>
    <h1>Put your documentation to work.</h1>
    <div class="auth-points">
      <div><span class="ic" data-ic="check" data-s="16"></span> Answers grounded in your own files, not general knowledge</div>
      <div><span class="ic" data-ic="check" data-s="16"></span> A citation on every single reply</div>
      <div><span class="ic" data-ic="check" data-s="16"></span> Handoff to a human in one tap, transcript attached</div>
    </div>
    <div class="auth-live"><span class="dot dot-live"></span><span><b id="authCounter">0</b> answers served from this workspace, and counting</span></div>
    <p class="auth-quote">"It paid for itself in week one. Our agents finally work on the tickets that actually need them." Priya N., Loopwell</p>
  </div>
  <div class="auth-right">
    <div class="auth-card">
      <h2>Sign in to Docent</h2>
      <p class="asub">Your workspace is where it left off.</p>
      <label>Email</label>
      <input class="inp" id="authEmail" value="maya@acme.io" autocomplete="off">
      <label>Password</label>
      <input class="inp" id="authPass" type="password" value="demo1234">
      <a class="auth-forgot" onclick="toast('Password reset email sent (demo)')">Forgot password?</a>
      <button class="btn btn-p" style="width:100%;justify-content:center" onclick="signIn()">Continue <span class="ic arr" data-ic="arrow" data-s="15"></span></button>
      <div class="auth-div">OR</div>
      <button class="btn btn-o" style="width:100%;justify-content:center" onclick="signIn(true)"><span class="ic" data-ic="zap" data-s="15"></span> Continue with demo account</button>
      <p class="auth-fine">Demo build. Any credentials work, and everything you do is saved in this browser only.</p>
    </div>
  </div>
</div>

<!-- ==================== LANDING ==================== -->
<div id="view-landing" class="view active">
  <header class="lnav">
    <div class="wrap">
      <a class="logo" href="#top"><span class="logo-mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.4-3A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14.5h3.5"/></svg></span> Docent</a>
      <nav class="links">
        <a href="#pipeline">How it works</a>
        <a href="#platform">Platform</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div class="right">
        <button class="login" onclick="enterApp()">Log in</button>
        <button class="btn btn-p btn-sm" onclick="enterApp()">Start free <span class="ic arr" data-ic="arrow" data-s="15"></span></button>
      </div>
    </div>
  </header>

  <section class="hero" id="top">
    <div class="wrap">
      <div>
        <div class="hero-eyebrow"><span class="dot"></span> Trained on your data. No code required.</div>
        <h1>Your knowledge, on duty <span class="hl">around the clock.<svg viewBox="0 0 200 12" preserveAspectRatio="none"><path d="M3 9 Q 50 2 100 7 T 197 5" fill="none" stroke="#f2a93b" stroke-width="5" stroke-linecap="round"/></svg></span></h1>
        <p class="sub">Docent reads your docs, help center and wikis, then answers your customers in seconds. <b>Every reply cites the exact passage it came from.</b> Try the live agent on the right. It runs on the real retrieval engine.</p>
        <div class="hero-ctas">
          <button class="btn btn-p" onclick="enterApp()">Build your agent <span class="ic arr" data-ic="arrow" data-s="16"></span></button>
          <button class="btn btn-o" id="btnWatch"><span class="ic" data-ic="zap" data-s="16"></span> Watch it answer</button>
        </div>
        <div class="hero-trust">
          <span><span class="ic" data-ic="check" data-s="13"></span> No credit card</span>
          <span><span class="ic" data-ic="check" data-s="13"></span> 2 minute setup</span>
          <span><span class="ic" data-ic="check" data-s="13"></span> Self-hosted</span>
        </div>
        <div class="queue">
          <div class="queue-head"><span class="dot"></span> Indexing pipeline <span class="qstat" id="qDone"><span class="ic" data-ic="check" data-s="12"></span> <span id="qCount">0 passages ready</span></span></div>
          <div id="qRows"></div>
        </div>
      </div>

      <div class="hero-right">
        <div class="widget" id="heroWidget">
          <div class="wg-head">
            <div class="wg-ava" style="background:var(--pine3);color:var(--mint)">S</div>
            <div><div class="wg-name">Sofia</div><div class="wg-sub"><span class="dot"></span> Docent's own support agent</div></div>
            <span class="wg-tag">LIVE</span>
          </div>
          <div class="wg-body" id="demoMsgs"></div>
          <div class="wg-chips" id="demoChips">
            <button onclick="askDemo('What does pricing look like?')">Pricing</button>
            <button onclick="askDemo('How do you train on my data?')">Training</button>
            <button onclick="askDemo('How do I embed it on my website?')">Embedding</button>
            <button onclick="askDemo('Is my data safe with you?')">Security</button>
          </div>
          <div class="wg-input">
            <input id="demoInput" placeholder="Ask the live agent" autocomplete="off">
            <button class="wg-send" id="demoSend"><span class="ic" data-ic="send" data-s="16"></span></button>
          </div>
          <div class="wg-foot">POWERED BY DOCENT</div>
        </div>
        <div class="ground"><span class="dot dot-live"></span> Grounded in <b id="kbCount">0</b> passages from docs.docent.ai</div>
      </div>
    </div>
  </section>

  <div class="marquee"><div class="mq-track" id="mqTrack"></div></div>

  <section class="sec" id="pipeline">
    <div class="wrap">
      <div class="sec-head reveal"><span class="idx">01 / HOW IT WORKS</span><h2>From raw documents to real answers.</h2></div>
      <div class="steps">
        <div class="step reveal"><div class="step-num">1</div>
          <div><h3>Ingest</h3><p>Upload PDFs, paste text, or connect Notion and Zendesk. Everything is chunked and indexed automatically, usually in under two minutes.</p></div>
          <div class="mini"><div class="mini-tiles"><i>PDF</i><i>URL</i><i>NOTION</i></div></div></div>
        <div class="step reveal" style="transition-delay:.06s"><div class="step-num">2</div>
          <div><h3>Train</h3><p>Your agent learns the facts and keeps a citation in every reply. Pin exact answers for the questions that matter most.</p></div>
          <div class="mini"><div class="mini-ring"></div><span class="mono" style="font-size:11px;color:var(--mut)">vectorizing</span></div></div>
        <div class="step reveal" style="transition-delay:.12s"><div class="step-num">3</div>
          <div><h3>Embed</h3><p>One script tag before the closing body tag. The widget takes your name, your colors and your welcome message.</p></div>
          <div class="mini"><div class="mini-code">&lt;<b>script</b> src="docent.ai/w.js"<br>&nbsp;&nbsp;<b>data-bot</b>="scout"&gt;&lt;/<b>script</b>&gt;</div></div></div>
        <div class="step reveal" style="transition-delay:.18s"><div class="step-num">4</div>
          <div><h3>Learn</h3><p>Thumbs up or down on any reply. Corrections reach the agent the moment you save them.</p></div>
          <div class="mini"><div class="mini-fb"><button><span class="ic" data-ic="thumbUp" data-s="16"></span></button><button><span class="ic" data-ic="thumbDown" data-s="16"></span></button></div></div></div>
      </div>
    </div>
  </section>

  <section class="sec bento-sec" id="platform">
    <div class="wrap">
      <div class="sec-head reveal"><span class="idx">02 / THE PLATFORM</span><h2>Launch takes minutes. The platform is everything after.</h2></div>
      <div class="bento">
        <div class="bcard b-a reveal">
          <h3>Every conversation, on the record.</h3>
          <p>Full transcripts, live status, and one click to take over from the bot.</p>
          <div class="mock">
            <div class="mock-row" onclick="enterApp('convos')"><span class="avatar" style="background:#ee6c4d">DW</span><div class="mtxt"><b>Dana W. was charged twice</b><span>"I flagged a refund. You will see it in 3 to 5 days."</span></div><span class="badge b-res">resolved</span><time>2m</time></div>
            <div class="mock-row" onclick="enterApp('convos')"><span class="avatar" style="background:#4d9de0">TO</span><div class="mtxt"><b>Tunde O. asked about API limits</b><span>"100 requests per minute on Scale. Source: api docs."</span></div><span class="badge b-open">open</span><time>11m</time></div>
            <div class="mock-row" onclick="enterApp('convos')"><span class="avatar" style="background:#8e6bd8">LS</span><div class="mtxt"><b>Lena S. wants to cancel</b><span>"Routing to a human. Priya has the full transcript."</span></div><span class="badge b-esc">handoff</span><time>26m</time></div>
          </div>
          <button class="go" onclick="enterApp('convos')">Open the inbox <span class="ic" data-ic="arrow" data-s="15"></span></button>
        </div>
        <div class="bcard b-c reveal" style="transition-delay:.08s">
          <h3>Know what is working.</h3>
          <p>Deflection, CSAT and top questions, updated live.</p>
          <div class="bigstat">92% <small>resolved without a human</small></div>
          <div class="chartbox"><svg viewBox="0 0 300 88" preserveAspectRatio="none"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#177e51" stop-opacity=".28"/><stop offset="1" stop-color="#177e51" stop-opacity="0"/></linearGradient></defs><path d="M0,70 C30,64 45,50 70,52 C95,54 110,38 140,36 C170,34 185,44 210,30 C235,16 260,22 300,10 L300,88 L0,88 Z" fill="url(#bg1)"/><path class="drawline" d="M0,70 C30,64 45,50 70,52 C95,54 110,38 140,36 C170,34 185,44 210,30 C235,16 260,22 300,10" fill="none" stroke="#177e51" stroke-width="2.5" stroke-linecap="round"/></svg></div>
        </div>
        <div class="bcard b-b reveal" style="transition-delay:.12s">
          <h3>Your brand, your bot.</h3>
          <p>Try a color.</p>
          <div class="swatches">
            <button style="background:#177e51" onclick="recolorMini('#177e51')"></button>
            <button style="background:#f2a93b" onclick="recolorMini('#f2a93b')"></button>
            <button style="background:#ee6c4d" onclick="recolorMini('#ee6c4d')"></button>
            <button style="background:#4d9de0" onclick="recolorMini('#4d9de0')"></button>
            <button style="background:#0d211a" onclick="recolorMini('#0d211a')"></button>
          </div>
          <div class="miniwg"><div class="mh" id="miniWgHead" style="background:#177e51"><i>S</i> Scout <span style="opacity:.7;font-weight:500">online</span></div><div class="mb">Hey. How can I help today?</div></div>
        </div>
        <div class="bcard b-d reveal" style="transition-delay:.16s">
          <h3>Real humans, right on time.</h3>
          <p>Smart escalation when sentiment dips.</p>
          <div class="handoff"><b><span class="ic" data-ic="bell" data-s="14"></span> Handoff requested</b><p>Lena S. wants a person. Context and transcript attached.</p><div class="acts"><button onclick="toast('Priya pinged in #support')">Accept in Slack</button><button onclick="toast('Snoozed 15 minutes')">Snooze</button></div></div>
        </div>
      </div>
      <div class="bcard b-wide reveal">
        <div class="globewrap"><span class="ic" data-ic="globe" data-s="34"></span></div>
        <div style="flex:1;min-width:260px">
          <h3>Use the language your customers use.</h3>
          <p>Pair Docent with a local multilingual model to answer visitors without creating duplicate bots.</p>
          <div class="langs"><span>EN</span><span>ES</span><span>DE</span><span>FR</span><span>PT</span><span>JA</span><span>한국어</span><span>हिन्दी</span><span>العربية</span><span>中文</span><span>IT</span><span>NL</span><span>+83</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="proof sec">
    <div class="wrap">
      <div class="proof-stats">
        <div class="pstat reveal"><div class="num" data-count="12.4" data-dec="1" data-suf="M">0</div><div class="lbl">Answers served monthly</div></div>
        <div class="pstat reveal" style="transition-delay:.08s"><div class="num" data-count="4800" data-suf="+">0</div><div class="lbl">Teams on Docent</div></div>
        <div class="pstat reveal" style="transition-delay:.16s"><div class="num" data-count="92" data-suf="%">0</div><div class="lbl">Avg. ticket deflection</div></div>
        <div class="pstat reveal" style="transition-delay:.24s"><div class="num" data-count="38" data-suf="s">0</div><div class="lbl">Median first reply</div></div>
      </div>
      <div class="quote reveal">
        <div class="qmark">"</div>
        <div>
          <blockquote>Docent cut our first response time from four hours to thirty eight seconds. Our agents finally work on the tickets that actually need them.</blockquote>
          <div class="who"><span class="avatar" style="background:var(--amber);color:var(--ink);width:44px;height:44px">PN</span><div><b>Priya Natarajan</b><span>Head of Support, Loopwell</span></div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="sec" id="pricing">
    <div class="wrap">
      <div class="sec-head reveal"><span class="idx">03 / PRICING</span><h2>Start free. Scale when it hurts.</h2>
        <div class="side"><div class="bill-toggle"><button class="on" id="billM" onclick="setBilling(false)">Monthly</button><button id="billY" onclick="setBilling(true)">Yearly<span class="save">-20%</span></button></div></div>
      </div>
      <div class="plans">
        <div class="plan reveal">
          <div class="pname">Starter</div><div class="pfor">For kicking the tires</div>
          <div class="price">$0</div><div class="per">forever</div>
          <ul>
            <li><span class="ic" data-ic="check" data-s="15"></span> 1 agent</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> 100 chats per month</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> PDF and text sources</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Basic analytics</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Community support</li>
          </ul>
          <button class="btn btn-o" onclick="enterApp()">Start free</button>
        </div>
        <div class="plan plan-feat reveal" style="transition-delay:.08s">
          <span class="tag">MOST TEAMS PICK THIS</span>
          <div class="pname">Pro</div><div class="pfor">For support and sales teams</div>
          <div class="price">$<span class="pv-m">29</span><span class="pv-y" style="display:none">23</span><small> /mo</small></div><div class="per"><span class="pv-m">billed monthly</span><span class="pv-y" style="display:none">billed yearly</span></div>
          <ul>
            <li><span class="ic" data-ic="check" data-s="15"></span> 5 agents, 10,000 chats per month</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> All integrations (Notion, Zendesk, more)</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Remove Docent branding</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Human handoff to Slack and email</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Advanced analytics and exports</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Priority support</li>
          </ul>
          <button class="btn btn-p" onclick="enterApp()">Start 14 day trial <span class="ic arr" data-ic="arrow" data-s="15"></span></button>
        </div>
        <div class="plan reveal" style="transition-delay:.16s">
          <div class="pname">Scale</div><div class="pfor">For serious volume</div>
          <div class="price">$<span class="pv-m">99</span><span class="pv-y" style="display:none">79</span><small> /mo</small></div><div class="per"><span class="pv-m">billed monthly</span><span class="pv-y" style="display:none">billed yearly</span></div>
          <ul>
            <li><span class="ic" data-ic="check" data-s="15"></span> 25 agents, 50,000 chats per month</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> SSO / SAML</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Self-hosting and audit controls</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> EU data residency</li>
            <li><span class="ic" data-ic="check" data-s="15"></span> Dedicated success manager</li>
          </ul>
          <button class="btn btn-o" onclick="toast('Our sales team will reach out (demo)')">Talk to us</button>
        </div>
      </div>
      <p class="price-note">All plans include unlimited teammates. Cancel anytime. Overage is $2 per 1,000 chats.</p>
    </div>
  </section>

  <section class="sec" id="faq" style="padding-top:40px">
    <div class="wrap faq-grid">
      <div class="faq-left reveal">
        <h2>Asked constantly.</h2>
        <p>Something else on your mind? The agent at the top of this page runs on the real engine. Ask it anything.</p>
        <button class="btn btn-o" style="margin-top:20px" onclick="askDemo('Is my data safe with you?');document.getElementById('heroWidget').scrollIntoView({behavior:'smooth',block:'center'})">Ask the live agent</button>
      </div>
      <div id="faqList">
        <div class="faq-item"><button onclick="toggleFaq(this)">How does training actually work?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>Upload documents, paste text, or connect Notion and Zendesk. Docent chunks the content, embeds it into a private index, and grounds every answer in it. Re-training after an upload takes seconds, not hours.</p></div></div>
        <div class="faq-item"><button onclick="toggleFaq(this)">Will it hallucinate or make things up?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>Answers are grounded in your sources with inline citations, and a strict "I don't know" fallback catches gaps. You can also pin question and answer pairs that always take priority over retrieval.</p></div></div>
        <div class="faq-item"><button onclick="toggleFaq(this)">What happens when it cannot answer?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>It refuses instead of guessing, returns the closest source citations, and records the conversation for review. Automatic Slack and shared-inbox handoff is the next support-workflow milestone.</p></div></div>
        <div class="faq-item"><button onclick="toggleFaq(this)">Where is my data stored?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>In the self-hosted build, agent sources and conversations stay on your own server. Production deployments should add encrypted storage, backups, access controls, and a retention policy before handling sensitive data.</p></div></div>
        <div class="faq-item"><button onclick="toggleFaq(this)">Can I try it before paying?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>Yes. The Starter plan is free forever, and Pro comes with a 14 day trial. No credit card required for either.</p></div></div>
        <div class="faq-item"><button onclick="toggleFaq(this)">Does the widget slow down my site?<span class="pm" data-ic="plus" data-s="14"></span></button><div class="faq-a"><p>The dependency-free loader is deferred and served from your Docent deployment. The chat UI is isolated in an iframe and does not add a frontend framework to the host page.</p></div></div>
      </div>
    </div>
  </section>

  <div class="cta-band reveal">
    <span class="wm">DOCENT</span>
    <h2>Your docs are ready to work.</h2>
    <p>Train your first agent in the next two minutes. Free forever, no card required.</p>
    <button class="btn" onclick="enterApp()">Create your first agent <span class="ic arr" data-ic="arrow" data-s="16"></span></button>
  </div>

  <footer>
    <div class="wrap">
      <div class="foot-grid">
        <div class="foot-brand">
          <a class="logo" style="color:#fff"><span class="logo-mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.4-3A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14.5h3.5"/></svg></span> Docent</a>
          <p>AI agents trained on your knowledge, with citations, handoffs and analytics.</p>
          <button class="foot-status" onclick="go('admin');setTimeout(()=>showAdmin('a-health'),150)"><span class="dot dot-live"></span> All systems operational</button>
        </div>
        <div><h4>Product</h4><a href="#pipeline">How it works</a><a href="#platform">Platform</a><a href="#pricing">Pricing</a><a onclick="toast('Changelog coming soon (demo)')">Changelog</a></div>
        <div><h4>Company</h4><a onclick="toast('About page (demo)')">About</a><a onclick="toast('Blog (demo)')">Blog</a><a onclick="toast('Careers (demo)')">Careers</a><a onclick="toast('Press kit (demo)')">Press</a></div>
        <div><h4>Resources</h4><a onclick="toast('Documentation (demo)')">Documentation</a><a onclick="toast('API reference (demo)')">API reference</a><a onclick="go('admin')">Admin console</a><a onclick="toast('Status page (demo)')">Status</a></div>
      </div>
      <div class="foot-bottom"><span>© 2026 Docent Labs, Inc.</span><span>Every reply cited. Every ticket tracked.</span></div>
    </div>
  </footer>
</div>

<!-- ==================== CLIENT APP ==================== -->
<div id="view-app" class="view">
  <aside class="app-side">
    <div class="ws-switch" onclick="toast('Workspace switcher (demo)')">
      <span class="ws-ava" id="wsAva">A</span>
      <div style="flex:1"><b id="wsName2">Acme Inc.</b><span>Pro plan</span></div>
      <span class="ic" data-ic="dots" data-s="15"></span>
    </div>
    <nav class="app-nav" id="appNav">
      <div class="nav-sec">Workspace</div>
      <button class="nav-it on" data-go="overview"><span class="ic" data-ic="grid" data-s="17"></span> Overview</button>
      <button class="nav-it" data-go="bots"><span class="ic" data-ic="bot" data-s="17"></span> My agents <span class="cnt" id="botCount">0</span></button>
      <button class="nav-it" data-go="convos"><span class="ic" data-ic="chat" data-s="17"></span> Conversations <span class="cnt" id="convoCount">0</span></button>
      <button class="nav-it" data-go="analytics"><span class="ic" data-ic="chart" data-s="17"></span> Analytics</button>
      <div class="nav-sec">Knowledge</div>
      <button class="nav-it" data-go="sources"><span class="ic" data-ic="db" data-s="17"></span> Data sources</button>
      <div class="nav-sec">Configure</div>
      <button class="nav-it" data-go="settings"><span class="ic" data-ic="cog" data-s="17"></span> Settings</button>
      <button class="nav-it" onclick="go('admin')"><span class="ic" data-ic="shield" data-s="17"></span> Admin console</button>
    </nav>
    <div class="usage">
      <div class="ul"><span>MESSAGES</span><b id="usageTxt">0 / 20,000</b></div>
      <div class="pbar"><i id="usageBar"></i></div>
      <a onclick="toast('Upgrade flow (demo)')">Upgrade for more</a>
    </div>
    <div class="user-chip" onclick="toggleUserMenu(event)">
      <span class="avatar" id="userAva" style="background:var(--coral)">MK</span>
      <div style="flex:1"><b id="userName">Maya Kapoor</b><span id="userEmail">maya@acme.io</span></div>
      <span class="ic" data-ic="dots" data-s="15"></span>
      <div class="user-menu" id="userMenu">
        <button onclick="showPanel('settings');closeUserMenu()"><span class="ic" data-ic="cog" data-s="14"></span> Settings</button>
        <button onclick="logOut()"><span class="ic" data-ic="logout" data-s="14"></span> Log out</button>
      </div>
    </div>
  </aside>

  <div class="app-main">
    <header class="app-top">
      <h2 id="topTitle">Overview</h2>
      <div class="top-search"><span class="ic" data-ic="search" data-s="15"></span><input id="topSearch" placeholder="Search conversations, sources"></div>
      <div class="top-right">
        <button class="btn btn-p btn-sm" onclick="openBotModal()"><span class="ic" data-ic="plus" data-s="15"></span> New agent</button>
        <div style="position:relative">
          <button class="bell" id="bellBtn"><span class="ic" data-ic="bell" data-s="17"></span><span class="bdg" id="bellBdg">0</span></button>
          <div class="bell-drop" id="bellDrop">
            <div class="bh">Notifications <button onclick="markRead()">Mark all read</button></div>
            <div id="notifList"></div>
          </div>
        </div>
        <span class="avatar" id="topAva" style="background:var(--coral);cursor:pointer" onclick="toggleUserMenu(event)">MK</span>
      </div>
    </header>

    <main class="app-content">
      <section class="panel on" data-panel="overview">
        <div class="panel-head">
          <div><h3 id="greet">Hello</h3><div class="ph-sub" id="todayLine"></div></div>
          <div class="ph-actions">
            <button class="btn btn-o btn-sm" onclick="copyEmbedGlobal()"><span class="ic" data-ic="code" data-s="15"></span> Copy embed</button>
            <button class="btn btn-o btn-sm" onclick="showPanel('settings')"><span class="ic" data-ic="users" data-s="15"></span> Invite teammate</button>
          </div>
        </div>
        <div class="stat-grid" id="statGrid"></div>
        <div class="ov-grid">
          <div class="card chart-card">
            <div class="ch">
              <b>Messages over time</b>
              <div style="display:flex;gap:14px;align-items:center">
                <div class="legend"><span><i style="background:var(--green)"></i>messages</span><span><i style="background:var(--amber)"></i>resolved</span></div>
                <div class="rtabs"><button class="on" data-range="14d" onclick="setRange(this)">14D</button><button data-range="30d" onclick="setRange(this)">30D</button><button data-range="90d" onclick="setRange(this)">90D</button></div>
              </div>
            </div>
            <div class="ovchart" id="ovChart"><div class="ov-vline" id="ovVline"></div><div class="ov-dot" id="ovDot"></div><div class="ov-tip" id="ovTip"></div></div>
          </div>
          <div class="card chart-card">
            <div class="ch"><b>My agents</b><button class="btn btn-g btn-xs" onclick="showPanel('bots')">View all</button></div>
            <div id="botRow"></div>
          </div>
        </div>
        <div class="card chart-card">
          <div class="ch"><b>Recent conversations</b><button class="btn btn-g btn-xs" onclick="showPanel('convos')">Open inbox</button></div>
          <div id="recentConvos"></div>
        </div>
      </section>

      <section class="panel" data-panel="bots">
        <div class="panel-head">
          <div><h3>My agents</h3><div class="ph-sub">Each agent has its own knowledge, style and embed.</div></div>
          <div class="ph-actions"><button class="btn btn-p btn-sm" onclick="openBotModal()"><span class="ic" data-ic="plus" data-s="15"></span> New agent</button></div>
        </div>
        <div class="bot-grid" id="botGrid"></div>
      </section>

      <section class="panel" data-panel="builder">
        <div class="bd-head">
          <button class="bd-back" onclick="showPanel('bots')"><span class="ic" data-ic="arrow" data-s="15" style="transform:rotate(180deg)"></span> All agents</button>
          <div class="bd-id" id="bdId"></div>
          <button class="btn btn-d btn-sm" id="btnDeleteBot" onclick="deleteBotStep(this)"><span class="ic" data-ic="trash" data-s="14"></span> Delete agent</button>
        </div>
        <div class="bd-tabs" id="bdTabs">
          <button class="on" data-tab="train" onclick="setTab(this)"><span class="ic" data-ic="db" data-s="15"></span> Training</button>
          <button data-tab="test" onclick="setTab(this)"><span class="ic" data-ic="chat" data-s="15"></span> Test chat</button>
          <button data-tab="look" onclick="setTab(this)"><span class="ic" data-ic="palette" data-s="15"></span> Appearance</button>
          <button data-tab="embed" onclick="setTab(this)"><span class="ic" data-ic="code" data-s="15"></span> Embed and share</button>
        </div>

        <div class="tabpane on" data-pane="train">
          <div class="two-col">
            <div class="card chart-card">
              <div class="ch"><b>Data sources</b><span class="chip" id="srcCountChip"></span></div>
              <div class="crawl-box">
                <label for="crawlUrl">Train from a website</label>
                <div class="crawl-row">
                  <input class="inp" id="crawlUrl" type="url" inputmode="url" placeholder="https://yourwebsite.com" autocomplete="url">
                  <select class="inp sel" id="crawlLimit" aria-label="Maximum pages">
                    <option value="10">10 pages</option>
                    <option value="20" selected>20 pages</option>
                    <option value="50">50 pages</option>
                    <option value="100">100 pages</option>
                  </select>
                  <button class="btn btn-p btn-sm" id="crawlButton" onclick="crawlWebsite()"><span class="ic" data-ic="globe" data-s="15"></span> Scan and train</button>
                </div>
                <div class="crawl-status" id="crawlStatus" role="status" aria-live="polite"><span class="spin"></span><span>Inspecting your brand and discovering useful pages…</span></div>
              </div>
              <div id="srcList"></div>
              <div class="add-src" style="margin-top:16px">
                <button class="btn btn-p btn-sm" onclick="document.getElementById('filePick').click()"><span class="ic" data-ic="upload" data-s="15"></span> Upload file</button>
                <button class="btn btn-o btn-sm" onclick="openPasteModal()"><span class="ic" data-ic="doc" data-s="15"></span> Paste text</button>
                <button class="btn btn-g btn-sm" onclick="loadSamples(curBotId())">Load sample docs</button>
                <input type="file" id="filePick" accept=".txt,.md,.csv,.json,.html,.text" style="display:none" onchange="handleFile(this)">
              </div>
              <p class="mono" style="font-size:10.5px;color:var(--mut);margin-top:12px">ACCEPTS .TXT .MD .CSV .JSON .HTML UP TO 100KB OF TEXT</p>
            </div>
            <div class="card chart-card">
              <div class="ch"><b>Pinned answers</b><span class="chip">always win over retrieval</span></div>
              <div id="qaList"></div>
              <div class="add-src" style="flex-direction:column">
                <input class="inp" id="qaQ" placeholder="Question, e.g. What is your refund policy?">
                <textarea class="inp ta" id="qaA" placeholder="The exact answer the agent should give"></textarea>
                <button class="btn btn-o btn-sm" style="align-self:flex-end" onclick="addQA()"><span class="ic" data-ic="plus" data-s="14"></span> Pin answer</button>
              </div>
            </div>
          </div>
        </div>

        <div class="tabpane" data-pane="test">
          <div class="two-col">
            <div class="card chart-card">
              <div class="ch"><b>Test environment</b><span class="badge b-train">sandbox</span></div>
              <p style="font-size:13.5px;color:var(--mut);line-height:1.65">This chat runs on the same retrieval engine as production. Answers come from this agent's <b id="testSrcN">0</b> connected sources, with citations. Feedback you leave here adjusts the CSAT score. Nothing is billed in test mode.</p>
              <div style="margin-top:18px;display:flex;flex-direction:column;gap:11px">
                <div class="tgl-row"><div><b>Strict mode</b><span>Only answer from sources, never improvise</span></div><label class="switch"><input type="checkbox" checked onchange="toast(this.checked?'Strict mode on':'Strict mode off')"><i></i></label></div>
                <div class="tgl-row"><div><b>Show citations</b><span>Link every answer to its source</span></div><label class="switch"><input type="checkbox" checked onchange="toast(this.checked?'Citations shown':'Citations hidden')"><i></i></label></div>
              </div>
              <button class="btn btn-o btn-sm" style="margin-top:16px" onclick="clearTest()"><span class="ic" data-ic="refresh" data-s="14"></span> Reset conversation</button>
            </div>
            <div class="widget" style="animation:none;width:100%">
              <div class="wg-head" id="testHead"></div>
              <div class="wg-body" id="testMsgs" style="height:300px"></div>
              <div class="wg-input">
                <input id="testInput" placeholder="Test your agent" autocomplete="off">
                <button class="wg-send" id="testSend"><span class="ic" data-ic="send" data-s="16"></span></button>
              </div>
            </div>
          </div>
        </div>

        <div class="tabpane" data-pane="look">
          <div class="two-col">
            <div class="card chart-card ap-form">
              <div class="ch"><b>Widget appearance</b></div>
              <div><label>Display name</label><input class="inp" id="apName" oninput="pvUpdate()"></div>
              <div><label>Brand color</label>
                <div class="color-row">
                  <input type="color" id="apColor" value="#177e51" oninput="pvUpdate()">
                  <button class="swb" style="background:#177e51" onclick="setSwatch('#177e51')"></button>
                  <button class="swb" style="background:#f2a93b" onclick="setSwatch('#f2a93b')"></button>
                  <button class="swb" style="background:#ee6c4d" onclick="setSwatch('#ee6c4d')"></button>
                  <button class="swb" style="background:#4d9de0" onclick="setSwatch('#4d9de0')"></button>
                  <button class="swb" style="background:#0d211a" onclick="setSwatch('#0d211a')"></button>
                </div>
              </div>
              <div><label>Welcome message</label><textarea class="inp ta" id="apWelcome" oninput="pvUpdate()"></textarea></div>
              <button class="btn btn-p" style="align-self:flex-start" onclick="saveAppearance()"><span class="ic" data-ic="check" data-s="15"></span> Save appearance</button>
            </div>
            <div class="pv-wrap">
              <div class="pv-label"><span class="dot"></span> Live preview. Updates as you type.</div>
              <div class="widget" style="animation:none;width:100%">
                <div class="wg-head" id="pvHead"><div class="wg-ava" id="pvAva" style="background:rgba(255,255,255,.18);color:#fff">S</div><div><div class="wg-name" id="pvName">Scout</div><div class="wg-sub"><span class="dot"></span> Online now</div></div></div>
                <div class="wg-body" style="height:180px"><div class="msg bot" id="pvWelcomeMsg">Hey. How can I help today?</div></div>
                <div class="wg-input"><input disabled placeholder="Type a message"><button class="wg-send" disabled><span class="ic" data-ic="send" data-s="16"></span></button></div>
              </div>
            </div>
          </div>
        </div>

        <div class="tabpane" data-pane="embed">
          <div class="two-col">
            <div class="card chart-card">
              <div class="ch"><b>Install the widget</b></div>
              <ul class="steps-list">
                <li><span class="n">1</span> Copy the snippet below.</li>
                <li><span class="n">2</span> Paste it just before the closing <code class="mono" style="font-size:12px;background:var(--panel2);padding:2px 7px;border-radius:5px">&lt;/body&gt;</code> tag on your site.</li>
                <li><span class="n">3</span> The launcher appears immediately.</li>
              </ul>
              <div class="code-block" id="embedCode"></div>
            </div>
            <div>
              <div class="card chart-card">
                <div class="ch"><b>Widget settings</b></div>
                <div class="tgl-row"><div><b>Launcher bubble</b><span>Show the floating chat button</span></div><label class="switch"><input type="checkbox" checked onchange="toast(this.checked?'Launcher visible':'Launcher hidden')"><i></i></label></div>
                <div class="tgl-row"><div><b>Remove Docent branding <span class="lock">PRO</span></b><span>Hide the powered by footer</span></div><label class="switch"><input type="checkbox" onchange="toast('Upgrade to Pro to remove branding')"><i></i></label></div>
                <div class="tgl-row"><div><b>Proactive greeting</b><span>Open chat after 10s of inactivity</span></div><label class="switch"><input type="checkbox" onchange="toast(this.checked?'Proactive greeting on':'Proactive greeting off')"><i></i></label></div>
              </div>
              <div class="card chart-card" style="margin-top:16px">
                <div class="ch"><b>Allowed domains</b></div>
                <div id="domainList" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
                <div style="display:flex;gap:9px">
                  <input class="inp" id="domainInput" placeholder="app.acme.io">
                  <button class="btn btn-o btn-sm" onclick="addDomain()"><span class="ic" data-ic="plus" data-s="14"></span> Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" data-panel="convos">
        <div class="panel-head">
          <div><h3>Conversations</h3><div class="ph-sub">Every chat across all your agents, in one inbox.</div></div>
          <div class="ph-actions">
            <button class="btn btn-o btn-sm" onclick="simulateVisitor()"><span class="ic" data-ic="users" data-s="15"></span> Simulate visitor</button>
            <button class="btn btn-o btn-sm" onclick="exportConvos()"><span class="ic" data-ic="download" data-s="15"></span> Export JSON</button>
          </div>
        </div>
        <div class="conv-grid">
          <div class="card conv-list-card">
            <div class="cf-tabs" id="cfTabs">
              <button class="on" data-cf="all" onclick="setConvFilter(this)">All</button>
              <button data-cf="open" onclick="setConvFilter(this)">Open</button>
              <button data-cf="resolved" onclick="setConvFilter(this)">Resolved</button>
              <button data-cf="escalated" onclick="setConvFilter(this)">Escalated</button>
            </div>
            <div class="conv-scroll" id="convList"></div>
          </div>
          <div class="card thread-card">
            <div class="thread-head" id="threadHead"></div>
            <div class="thread-body" id="threadMsgs"></div>
            <div class="thread-foot">
              <input class="inp" id="threadReply" placeholder="Reply as a human">
              <button class="btn btn-p btn-sm" id="threadSend"><span class="ic" data-ic="send" data-s="15"></span> Send</button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" data-panel="analytics">
        <div class="panel-head">
          <div><h3>Analytics</h3><div class="ph-sub">Computed from your real message events.</div></div>
          <div class="ph-actions"><button class="btn btn-o btn-sm" onclick="exportConvos()"><span class="ic" data-ic="download" data-s="15"></span> Export data</button></div>
        </div>
        <div class="an-grid">
          <div class="card chart-card"><div class="ch"><b>Messages by weekday</b><span class="chip">last 30 days</span></div><div id="anBars"></div></div>
          <div class="card chart-card"><div class="ch"><b>Outcomes</b></div><div class="donut-wrap" id="anDonut"></div></div>
        </div>
        <div class="card chart-card">
          <div class="ch"><b>Top questions</b><span class="chip">from real visitor messages</span></div>
          <table class="tbl"><thead><tr><th>Question</th><th>Asks</th><th>Trend</th><th>Resolved</th></tr></thead><tbody id="topQ"></tbody></table>
        </div>
      </section>

      <section class="panel" data-panel="sources">
        <div class="panel-head">
          <div><h3>Data sources</h3><div class="ph-sub">Everything your agents know, in one place.</div></div>
          <div class="ph-actions">
            <button class="btn btn-o btn-sm" onclick="loadSamples(null)"><span class="ic" data-ic="doc" data-s="15"></span> Load sample docs</button>
            <button class="btn btn-p btn-sm" onclick="document.getElementById('filePick2').click()"><span class="ic" data-ic="upload" data-s="15"></span> Upload file</button>
            <input type="file" id="filePick2" accept=".txt,.md,.csv,.json,.html,.text" style="display:none" onchange="handleFile(this)">
          </div>
        </div>
        <div class="card" style="overflow-x:auto">
          <table class="tbl"><thead><tr><th>Source</th><th>Type</th><th>Agent</th><th>Passages</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody id="srcTable"></tbody></table>
        </div>
      </section>

      <section class="panel" data-panel="settings">
        <div class="panel-head"><div><h3>Settings</h3><div class="ph-sub">Workspace, team and data.</div></div></div>
        <div class="two-col">
          <div>
            <div class="card chart-card">
              <div class="ch"><b>Workspace</b></div>
              <label class="mono" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);display:block;margin-bottom:7px">Workspace name</label>
              <div style="display:flex;gap:9px"><input class="inp" id="wsName" value="Acme Inc."><button class="btn btn-p btn-sm" onclick="saveWs()">Save</button></div>
            </div>
            <div class="card chart-card" style="margin-top:16px">
              <div class="ch"><b>Your account</b></div>
              <div class="src-item"><span class="avatar" id="setAva" style="background:var(--coral)">MK</span><div class="st"><b id="setName" style="font-family:var(--body);font-weight:600">Maya Kapoor</b><span id="setEmail">maya@acme.io</span></div><button class="btn btn-g btn-xs" onclick="logOut()">Log out</button></div>
            </div>
            <div class="card chart-card" style="margin-top:16px;border-color:#f3c9bd">
              <div class="ch"><b style="color:#c04426">Danger zone</b></div>
              <div class="tgl-row" style="border-color:#f3c9bd"><div><b>Reset demo data</b><span>Restores the original seed. Your uploads and chats are wiped.</span></div><button class="btn btn-d btn-sm" onclick="resetAll()">Reset</button></div>
            </div>
          </div>
          <div class="card chart-card">
            <div class="ch"><b>Team</b><span class="chip" id="teamCount"></span></div>
            <div id="teamList"></div>
            <div class="add-src" style="margin-top:16px">
              <input class="inp" id="inviteEmail" placeholder="teammate@acme.io">
              <button class="btn btn-p btn-sm" onclick="inviteMember()"><span class="ic" data-ic="users" data-s="15"></span> Invite</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>

<!-- ==================== ADMIN ==================== -->
<div id="view-admin" class="view">
  <aside class="app-side">
    <div class="ws-switch" onclick="go('landing')"><span class="ws-ava" style="background:var(--coral)">D</span><div style="flex:1"><b>Docent HQ</b><span>Platform ops</span></div><span class="ic" data-ic="arrow" data-s="14" style="transform:rotate(180deg)"></span></div>
    <nav class="app-nav" id="admNav">
      <div class="nav-sec">Platform</div>
      <button class="nav-it on" data-go="a-overview"><span class="ic" data-ic="grid" data-s="17"></span> Overview</button>
      <button class="nav-it" data-go="a-users"><span class="ic" data-ic="users" data-s="17"></span> Users</button>
      <button class="nav-it" data-go="a-bots"><span class="ic" data-ic="bot" data-s="17"></span> All bots</button>
      <div class="nav-sec">Operations</div>
      <button class="nav-it" data-go="a-billing"><span class="ic" data-ic="zap" data-s="17"></span> Usage and billing</button>
      <button class="nav-it" data-go="a-health"><span class="ic" data-ic="shield" data-s="17"></span> System health</button>
      <button class="nav-it" data-go="a-logs"><span class="ic" data-ic="file" data-s="17"></span> Audit log</button>
      <div class="nav-sec">Demo</div>
      <button class="nav-it" onclick="go('app')"><span class="ic" data-ic="logout" data-s="17"></span> Client app</button>
    </nav>
    <div class="user-chip" onclick="go('landing')"><span class="avatar" style="background:var(--sky)">RT</span><div style="flex:1"><b>root@docent</b><span>superadmin</span></div></div>
  </aside>

  <div class="app-main">
    <header class="app-top">
      <h2 id="admTitle">Platform overview</h2>
      <span class="adm-badge">INTERNAL / v2.41.0</span>
      <div class="top-right">
        <div class="top-search" style="margin-left:0"><span class="ic" data-ic="search" data-s="15"></span><input id="admSearch" placeholder="Search users"></div>
        <button class="btn btn-ink btn-sm" onclick="go('app')">Open client app</button>
      </div>
    </header>

    <main class="app-content">
      <section class="panel on" data-apanel="a-overview">
        <div class="ticker" style="margin-bottom:20px"><span class="live"><span class="dot"></span>LIVE</span><span id="tickText">maya@acme.io created bot "Atlas"</span></div>
        <div class="stat-grid">
          <div class="astat"><div class="sl">Total users</div><div class="sv" data-count="4812">0</div><span class="sd2"><b>+38</b> this week</span></div>
          <div class="astat"><div class="sl">Active bots</div><div class="sv" data-count="11247">0</div><span class="sd2"><b>+214</b> this week</span></div>
          <div class="astat"><div class="sl">Messages today</div><div class="sv" data-count="412806">0</div><span class="sd2"><b>+12.4%</b> vs yesterday</span></div>
          <div class="astat"><div class="sl">MRR</div><div class="sv" data-count="186420" data-pre="$">0</div><span class="sd2"><b>+4.2%</b> MoM</span></div>
        </div>
        <div class="ov-grid">
          <div class="card chart-card"><div class="ch"><b style="color:var(--txt)">Platform messages, 30 days</b><span class="chip" style="background:var(--panel2);border-color:var(--line2);color:var(--mut)">all workspaces</span></div><div id="platChart"></div></div>
          <div class="card chart-card">
            <div class="ch"><b style="color:var(--txt)">Recent signups</b></div>
            <table class="tbl"><thead><tr><th>Workspace</th><th>Plan</th><th>When</th></tr></thead><tbody id="signupsTable"></tbody></table>
          </div>
        </div>
      </section>

      <section class="panel" data-apanel="a-users">
        <div class="panel-head"><div><h3>Users</h3><div class="ph-sub">Every workspace owner on the platform.</div></div></div>
        <div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>User</th><th>Plan</th><th>Bots</th><th>Msgs / mo</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody id="admUsers"></tbody></table></div>
      </section>

      <section class="panel" data-apanel="a-bots">
        <div class="panel-head"><div><h3>All bots</h3><div class="ph-sub">Live agents across every workspace. Yours are merged in from the client app.</div></div></div>
        <div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Bot</th><th>Workspace</th><th>Plan</th><th>Msgs / mo</th><th>CSAT</th><th>Status</th></tr></thead><tbody id="admBots"></tbody></table></div>
      </section>

      <section class="panel" data-apanel="a-billing">
        <div class="panel-head"><div><h3>Usage and billing</h3><div class="ph-sub">Revenue, plan mix and invoices.</div></div></div>
        <div class="an-grid">
          <div class="card chart-card"><div class="ch"><b style="color:var(--txt)">Revenue, 6 months</b><span class="chip" style="background:var(--panel2);border-color:var(--line2);color:var(--mut)">MRR $186.4k</span></div><div id="revBars"></div></div>
          <div class="card chart-card"><div class="ch"><b style="color:var(--txt)">Plan distribution</b></div><div class="donut-wrap" id="planDonut"></div></div>
        </div>
        <div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Invoice</th><th>Workspace</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody id="invTable"></tbody></table></div>
      </section>

      <section class="panel" data-apanel="a-health">
        <div class="panel-head"><div><h3>System health</h3><div class="ph-sub">Live service status and 30 day uptime windows.</div></div><div class="ph-actions"><span class="badge b-live" style="font-size:11.5px"><span class="dot dot-live"></span> All operational</span></div></div>
        <div id="svcList"></div>
      </section>

      <section class="panel" data-apanel="a-logs">
        <div class="panel-head">
          <div><h3>Audit log</h3><div class="ph-sub">Streaming platform events.</div></div>
          <div class="ph-actions">
            <div class="lf-chips" id="lfChips"><button class="on" data-lf="all" onclick="setLogFilter(this)">all</button><button data-lf="warn" onclick="setLogFilter(this)">warn</button><button data-lf="err" onclick="setLogFilter(this)">error</button></div>
            <button class="btn btn-ink btn-sm" id="logPause" onclick="toggleLogPause()">Pause</button>
          </div>
        </div>
        <div id="logFeed"></div>
      </section>
    </main>
  </div>
</div>

<!-- NEW BOT MODAL -->
<div class="modal" id="modalBot">
  <div class="modal-card">
    <h3>Create a new agent</h3>
    <p class="msub">It starts training the moment you hit create.</p>
    <div class="mfield"><label>Agent name</label><input class="inp" id="mbName" placeholder="e.g. Luna"></div>
    <div class="mfield"><label>Brand color</label>
      <div class="color-row">
        <input type="color" id="mbColor" value="#177e51">
        <button class="swb" style="background:#177e51" onclick="$('#mbColor').value='#177e51'"></button>
        <button class="swb" style="background:#4d9de0" onclick="$('#mbColor').value='#4d9de0'"></button>
        <button class="swb" style="background:#ee6c4d" onclick="$('#mbColor').value='#ee6c4d'"></button>
        <button class="swb" style="background:#f2a93b" onclick="$('#mbColor').value='#f2a93b'"></button>
        <button class="swb" style="background:#8e6bd8" onclick="$('#mbColor').value='#8e6bd8'"></button>
      </div>
    </div>
    <div class="mfield"><label>What does it do?</label><input class="inp" id="mbDesc" placeholder="e.g. Answers billing questions for Acme Cloud"></div>
    <div class="mfield"><label>Seed with sources</label>
      <div class="msrcs" id="mbSrcs"></div>
      <button class="btn btn-g btn-xs" style="margin-top:9px" onclick="loadSamples(null);openBotModal(true)">Load sample docs first</button>
    </div>
    <div class="modal-foot">
      <button class="btn btn-o" onclick="closeBotModal()">Cancel</button>
      <button class="btn btn-p" onclick="createBot()"><span class="ic" data-ic="zap" data-s="15"></span> Create and train</button>
    </div>
  </div>
</div>

<!-- PASTE TEXT MODAL -->
<div class="modal" id="modalPaste">
  <div class="modal-card">
    <h3>Paste text source</h3>
    <p class="msub">Anything you paste is chunked and indexed for this agent.</p>
    <div class="mfield"><label>Source name</label><input class="inp" id="psName" placeholder="e.g. Support macros"></div>
    <div class="mfield"><label>Content</label><textarea class="inp ta" id="psBody" style="min-height:160px" placeholder="Paste the document text here"></textarea></div>
    <div class="modal-foot">
      <button class="btn btn-o" onclick="$('#modalPaste').classList.remove('open')">Cancel</button>
      <button class="btn btn-p" onclick="addPasted()">Index text</button>
    </div>
  </div>
</div>

<script>
/* ============ HELPERS ============ */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rnd=(a,b)=>Math.round(a+Math.random()*(b-a));
const initials=n=>n.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
function toast(msg,ic='check'){const t=document.createElement('div');t.className='toast';t.innerHTML=`<span class="ic" style="width:16px;height:16px">${I[ic]||I.check}</span>${esc(msg)}`;$('#toasts').appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),320)},2900);}
function copyText(txt){try{navigator.clipboard.writeText(txt);toast('Copied to clipboard');}catch(e){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('Copied to clipboard');}catch(x){toast('Copy failed');}ta.remove();}}

/* ============ ICONS ============ */
const IC=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%">${p}</svg>`;
const I={
grid:IC('<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>'),
bot:IC('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M9 5h6"/><circle cx="9.5" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13" r="1.1" fill="currentColor" stroke="none"/><path d="M9.5 16.5h5"/>'),
chat:IC('<path d="M21 12a8 8 0 0 1-8 8H4l2.4-3A8 8 0 1 1 21 12z"/>'),
chart:IC('<path d="M5 20v-8M11 20V5M17 20v-5M3 20h18"/>'),
db:IC('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
palette:IC('<path d="M12 3a9 9 0 1 0 0 18c1.6 0 2.1-1.1 1.6-2.1-.5-1.1 0-2.2 1.6-2.2h2.1A3.7 3.7 0 0 0 21 13c0-5.5-4-10-9-10z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/>'),
code:IC('<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>'),
cog:IC('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'),
bell:IC('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"/>'),
search:IC('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
plus:IC('<path d="M12 5v14M5 12h14" stroke-width="2"/>'),
up:IC('<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>'),
upload:IC('<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>'),
download:IC('<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>'),
check:IC('<path d="M4 12l5 5L20 7" stroke-width="2.2"/>'),
x:IC('<path d="M6 6l12 12M18 6L6 18" stroke-width="2"/>'),
arrow:IC('<path d="M4 12h16M13 5l7 7-7 7" stroke-width="2"/>'),
send:IC('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>'),
users:IC('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.8 3.5 2.6 3.5 5.7"/>'),
shield:IC('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
zap:IC('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
globe:IC('<circle cx="12" cy="12" r="9" stroke-width="1.6"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z" stroke-width="1.6"/>'),
copy:IC('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
dots:IC('<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
refresh:IC('<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>'),
trash:IC('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
eye:IC('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
logout:IC('<path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H8"/>'),
file:IC('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M10 13h5M10 17h5"/>'),
doc:IC('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
link:IC('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>'),
thumbUp:IC('<path d="M7 11v9H4v-9h3zM7 11l4.5-8c1.4 0 2.5 1.1 2.5 2.5V10h4.4c1.2 0 2.1 1.1 1.8 2.3l-1.3 6.2A2 2 0 0 1 16.9 20H7"/>'),
thumbDown:IC('<path d="M17 13V4h3v9h-3zM17 13l-4.5 8c-1.4 0-2.5-1.1-2.5-2.5V14H5.6c-1.2 0-2.1-1.1-1.8-2.3l1.3-6.2A2 2 0 0 1 7.1 4H17"/>')
};
function icon(n,s=18){return `<span class="ic" style="width:${s}px;height:${s}px">${I[n]||''}</span>`}
function hydrateIcons(){$$('[data-ic]').forEach(el=>{el.classList.add('ic');el.style.width=(el.dataset.s||18)+'px';el.style.height=(el.dataset.s||18)+'px';el.innerHTML=I[el.dataset.ic]||'';});}

/* ============ KNOWLEDGE BASES ============ */
const DOCENT_KB=`Docent is a self-hosted website support agent. The current community build can inspect a public website, crawl same-domain pages, extract useful text, detect a logo and brand color, and create an embeddable chat widget.
Training and data. Add a website URL, plain-text files, pasted text, or pinned question-and-answer pairs. Website pages are cleaned and split into overlapping passages. Pinned answers take priority over normal retrieval.
Grounded answers. Docent searches connected passages before answering, returns source citations, and refuses when it cannot find enough evidence. Extractive mode runs without a paid model. A local Ollama model can improve fluency while keeping the retrieved passages as the only allowed context. No AI system can promise zero hallucinations, so important deployments should also use evaluation sets, monitoring, and human escalation.
Embedding the widget. Installation uses one deferred script tag before the closing body tag. The dependency-free loader opens an isolated iframe and takes the agent name, color, logo, and welcome message from the dashboard.
Security and privacy. The community build stores its data on the server you run. Before handling sensitive customer data, configure authentication, encrypted production storage, backups, domain checks, rate limits, and a retention policy.
Cost. The core build uses Node.js and an optional local Ollama model, so it can run without a paid AI API. Hosting and hardware still have real costs at scale.`;
const SAMPLE_DOCS=[
{n:'refund-policy.txt',t:'txt',body:'Acme Cloud refund policy. You can request a full refund within 30 days of purchase, no questions asked. After 30 days, annual plans receive prorated account credit. Monthly plans are not refundable after the 30 day window. Refunds are issued to the original payment method within 3 to 5 business days. To request a refund, email billing@acme.io or use the billing page in your dashboard. Duplicate charges are always refunded in full. Contact support if a refund has not arrived after 5 business days.'},
{n:'product-handbook.txt',t:'txt',body:'Acme Cloud product handbook. Acme Cloud is a project tracking tool for product teams. Core features include issues, sprints, roadmaps and reports. The API allows 100 requests per minute on the Scale plan and 30 on Pro. Bursts up to double the limit are allowed for 10 seconds. Data can be exported as CSV or JSON from the Settings page. Integrations include Slack, GitHub, Figma and Zendesk. Seats can be added or removed at any time and billing is prorated automatically. Two factor authentication is available on all plans. SSO and SAML are available on the Scale plan only.'},
{n:'pricing-page.txt',t:'txt',body:'Acme Cloud pricing. The Starter plan is free and includes 3 projects and 5 guests. Pro costs 12 dollars per seat per month and adds unlimited projects, API access and priority support. Scale costs 24 dollars per seat per month and adds SSO, audit logs and a 99.9 percent uptime SLA. Annual billing saves 20 percent on all paid plans. Nonprofits and education teams receive a 40 percent discount. Invoices are issued monthly or annually and can be downloaded from the billing page.'},
{n:'onboarding-guide.txt',t:'txt',body:'New hire onboarding guide. Welcome to Acme. Day 1: set up payroll in BambooHR and post in the introductions channel. Day 2: your laptop arrives, and IT tracks delivery in the it-requests channel. Day 3: meet your buddy and review the team handbook. By Friday, complete security training in the learning portal. Your manager schedules one on ones for your first two weeks. Ask anything in the questions channel. There are no silly questions.'},
{n:'sales-playbook.txt',t:'txt',body:'Acme sales playbook. When a prospect asks about competitors, focus on our native reporting and the free plan. Offer a 14 day Pro trial with no card required. Discounts are 20 percent for annual billing and 40 percent for education. Never discount more than 50 percent. Deals over 10 thousand dollars need VP approval. Book demos at acme.io/demo, 30 minutes with a product specialist. Follow up within one business day, always.'}
];

/* ============ RETRIEVAL ENGINE ============ */
const STOP=new Set('the a an and or but if then else for to of in on at is are was were be been being it its this that these those you your yours i we they he she as by with from about into over after before can could would should shall do does did not no yes what which who whom how when where why will would like me my our us'.split(' '));
function tokens(s){return String(s).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w));}
function chunkText(text,size=380){
  const clean=text.replace(/\s+/g,' ').trim();
  const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];
  const chunks=[];let cur='';
  for(const s of sentences){const st=s.trim();if(!st)continue;
    if((cur+' '+st).length>size&&cur){chunks.push(cur);cur=st;}else cur=cur?cur+' '+st:st;}
  if(cur)chunks.push(cur);
  return chunks.filter(c=>c.length>20);
}
function scoreChunk(qt,text){const set=new Set(tokens(text));let hit=0;for(const w of qt)if(set.has(w))hit++;
  if(!qt.length)return 0;return hit/qt.length+hit*0.04;}
function retrieve(srcs,q){const qt=[...new Set(tokens(q))];const out=[];
  for(const src of srcs)for(const ch of src.chunks||[]){const sc=scoreChunk(qt,ch);if(sc>0)out.push({sc,text:ch,source:src.name});}
  return out.sort((a,b)=>b.sc-a.sc);}
function compose(bot,q){
  const qt=[...new Set(tokens(q))];
  for(const qa of (DB.qas[bot.id]||[])){const qset=new Set(tokens(qa.q));const ov=qt.filter(w=>qset.has(w)).length;
    if(ov>=2||(qt.length===1&&qset.has(qt[0])))return{t:qa.a,src:'Pinned answer'};}
  const srcs=DB.sources.filter(s=>s.botId===bot.id&&s.status==='ready');
  const hits=retrieve(srcs,q);
  if(!hits.length||hits[0].sc<0.34)return{t:`I could not find that in my ${srcs.length} connected source${srcs.length===1?'':'s'}. Try rephrasing, or type "human" and I will route you to the team.`,src:null};
  const h=hits[0];const sent=h.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[h.text];
  let best=sent[0],bs=-1;for(const s of sent){const sc=scoreChunk(qt,s);if(sc>bs){bs=sc;best=s;}}
  const idx=sent.indexOf(best);let ans=best.trim();
  if(sent[idx+1]&&ans.length<170)ans+=' '+sent[idx+1].trim();
  return{t:ans.slice(0,360),src:h.source};
}
const INTENTS=[
 {re:/^(hi|hey|hello|hlo|yo|sup|good (morning|afternoon|evening))\b/i,t:b=>`Hey. I am ${b.name}. Ask me anything covered by my sources and I will cite where each answer comes from.`},
 {re:/(thank|thanks|thx|cheers)/i,t:()=>'Any time. Anything else I can dig up?'},
 {re:/(human|real person|talk to someone|live agent|support team)/i,t:()=>'I cannot route a live handoff in this community build yet. Please use the site support contact, and the conversation will remain available for review.'},
 {re:/\b(bye|goodbye|see you)\b/i,t:()=>'Take care. I am here around the clock.'}
];
function respond(bot,q){for(const it of INTENTS)if(it.re.test(q))return{t:it.t(bot),src:null};return compose(bot,q);}

/* ============ DATABASE ============ */
const KEY='docent_v3';
let DB=null;
function mkSrc(id,botId,doc,ago){return{id,botId,name:doc.n,type:doc.t,size:(doc.body.length/1024).toFixed(1)+' KB',status:'ready',added:ago,chunks:chunkText(doc.body)};}
function freshDB(){
  const now=Date.now();
  const s1=mkSrc('s1','b1',SAMPLE_DOCS[0],'Jul 21'),s2=mkSrc('s2','b1',SAMPLE_DOCS[1],'Jul 21'),
        s3=mkSrc('s3','b1',SAMPLE_DOCS[2],'Jul 22'),s4=mkSrc('s4','b2',SAMPLE_DOCS[2],'Jul 18'),
        s5=mkSrc('s5','b2',SAMPLE_DOCS[4],'Jul 15'),s6=mkSrc('s6','b3',SAMPLE_DOCS[3],'Jul 24');
  const events=[];
  for(let d=89;d>=0;d--){const n=Math.max(4,rnd(20,60)-Math.round(d/4));
    for(let i=0;i<n;i++)events.push({ts:now-d*864e5-rnd(0,86000000),t:'msg',bot:['b1','b1','b1','b2','b3'][rnd(0,4)]});
    for(let i=0;i<Math.round(n*.72);i++)events.push({ts:now-d*864e5-rnd(0,86000000),t:'res'});
    for(let i=0;i<Math.round(n*.07);i++)events.push({ts:now-d*864e5-rnd(0,86000000),t:'esc'});}
  const mk=(id,user,hue,botId,mins,status,msgs)=>({id,user,hue,botId,ts:now-mins*60000,status,msgs});
  return{
    user:null,ws:'Acme Inc.',
    bots:[
      {id:'b1',name:'Scout',color:'#177e51',desc:'Customer support for Acme Cloud. Billing, bugs and how-tos.',status:'live',msgs:5241,welcome:'Hey. How can I help today?'},
      {id:'b2',name:'Atlas',color:'#4d9de0',desc:'Sales and pricing questions, demo booking, plan comparisons.',status:'live',msgs:2187,welcome:'Hi there. Want a hand picking a plan?'},
      {id:'b3',name:'Nova',color:'#f2a93b',desc:'New hire onboarding helper for the People team.',status:'training',progress:62,msgs:0,welcome:'Welcome aboard. Ask me anything about your first week.'}],
    sources:[s1,s2,s3,s4,s5,s6],
    qas:{b1:[{q:'What is your refund policy?',a:'Full refunds within 30 days, no questions asked. After that, annual plans get prorated credit.'},{q:'Do you offer startup discounts?',a:'Yes. 50 percent off Pro for the first year through the Acme for Startups program.'}],
         b2:[{q:'Can I book a demo?',a:'Absolutely. Grab any slot at acme.io/demo. It is 30 minutes with a product specialist.'}]},
    convos:[
      mk('c1','Dana Whitfield','#ee6c4d','b1',2,'open',[{f:'user',t:'Hi. My invoice charged me twice this month.'},{f:'bot',t:'Sorry about that, Dana. I can see two charges on Jul 3 and have flagged this for billing. You will see a refund within 3 to 5 business days.',src:'refund-policy.txt'},{f:'user',t:'Amazing, thank you.'}]),
      mk('c2','Tunde Okafor','#4d9de0','b1',11,'open',[{f:'user',t:'What are the API rate limits on Scale?'},{f:'bot',t:'On the Scale plan you get 100 requests per minute, with bursts up to double for 10 seconds.',src:'product-handbook.txt'}]),
      mk('c3','Lena Sorensen','#8e6bd8','b1',26,'escalated',[{f:'user',t:'I need to cancel, and honestly I want to talk to someone about why.'},{f:'bot',t:'I understand. Routing you to a human now. Priya from our team has the full transcript.'},{f:'agent',t:'Hi Lena, Priya here. Sorry to hear that. Can we grab 10 minutes on a call tomorrow?'}]),
      mk('c4','Marco Bianchi','#177e51','b2',64,'resolved',[{f:'user',t:'Difference between Pro and Scale for 8 seats?'},{f:'bot',t:'For 8 seats, Scale adds SSO and audit logs at 24 dollars per seat. Pro is 12 per seat with unlimited projects.',src:'pricing-page.txt'},{f:'user',t:'Perfect, upgrading now.'}]),
      mk('c5','Aisha Rahman','#f2a93b','b3',180,'resolved',[{f:'user',t:'First day! Where do I set up payroll?'},{f:'bot',t:'Welcome to Acme. Payroll setup lives in BambooHR, section 2 of your onboarding checklist. It takes about 10 minutes.',src:'onboarding-guide.txt'}]),
      mk('c6','Jonas Weber','#ee6c4d','b2',300,'open',[{f:'user',t:'Do you support SAML on Pro?'},{f:'bot',t:'SAML and SSO are available on the Scale plan only. On Pro you get invite based access with role controls.',src:'product-handbook.txt'}])],
    events,fb:{b1:{up:38,down:4},b2:{up:19,down:3},b3:{up:6,down:1}},
    notifs:[{t:'Nova is still training on onboarding-guide.txt',time:'12m ago',read:false},{t:'3 conversations escalated to #support',time:'1h ago',read:false},{t:'You used 42 percent of monthly messages',time:'Yesterday',read:false}],
    team:[{n:'Maya Kapoor',e:'maya@acme.io',role:'Owner',hue:'#ee6c4d'},{n:'Arjun Mehta',e:'arjun@acme.io',role:'Editor',hue:'#4d9de0'},{n:'Sofia Reyes',e:'sofia@acme.io',role:'Viewer',hue:'#177e51'}],
    domains:['acme.io','app.acme.io'],
    demoSrc:{name:'docs.docent.ai',chunks:chunkText(DOCENT_KB)}
  };
}
function loadDB(){try{const raw=localStorage.getItem(KEY);if(raw){DB=JSON.parse(raw);if(!DB.demoSrc)DB.demoSrc={name:'docs.docent.ai',chunks:chunkText(DOCENT_KB)};return;}}catch(e){}DB=freshDB();saveDB();}
function saveDB(){try{localStorage.setItem(KEY,JSON.stringify(DB));}catch(e){}}
function resetAll(){localStorage.removeItem(KEY);location.reload();}
function pushNotif(t){DB.notifs.unshift({t,time:'Just now',read:false});DB.notifs=DB.notifs.slice(0,8);saveDB();renderNotifs();}
function logEvent(t,bot){DB.events.push({ts:Date.now(),t,bot});if(DB.events.length>4000)DB.events.splice(0,500);saveDB();}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  let data={};try{data=await response.json();}catch(e){}
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}
function agentPayload(id){
  const b=DB.bots.find(bot=>bot.id===id);if(!b)return null;
  return{name:b.name,color:b.color,logo:b.logo||'',welcome:b.welcome,allowedDomains:DB.domains,
    qas:DB.qas[id]||[],sources:DB.sources.filter(s=>s.botId===id)};
}
async function syncAgent(id){
  const payload=agentPayload(id);if(!payload)return null;
  return api(`/api/agents/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify(payload)});
}

/* ============ STATE ============ */
const S={view:'landing',panel:'overview',curBot:'b1',curConvo:'c1',convFilter:'all',range:'14d',logFilter:'all',logPaused:false};
const DEMO_BOT={id:'demo',name:'Sofia'};

/* ============ VIEWS ============ */
function go(v){S.view=v;$$('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');
 $$('#demoNav button').forEach(b=>b.classList.toggle('on',b.dataset.view===v));window.scrollTo(0,0);
 if(v==='admin')runAdminCounters();
 if(v==='app')refreshApp();}
$$('#demoNav button').forEach(b=>b.onclick=()=>go(b.dataset.view));
function enterApp(panel){if(!DB.user){go('auth');return;}go('app');if(panel)showPanel(panel);}
function signIn(demo){
  const em=demo?'maya@acme.io':$('#authEmail').value.trim();
  if(!em.includes('@')){toast('Enter a valid email','x');return;}
  const name=demo?'Maya Kapoor':em.split('@')[0].replace(/[._-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  DB.user={name,email:em};saveDB();applyUser();go('app');toast(`Welcome back, ${name.split(' ')[0]}`);}
function logOut(){DB.user=null;saveDB();closeUserMenu();go('auth');toast('Logged out');}
function applyUser(){const u=DB.user||{name:'Guest',email:'guest@demo'};const ini=initials(u.name);
  $('#userName').textContent=u.name;$('#userEmail').textContent=u.email;$('#userAva').textContent=ini;$('#topAva').textContent=ini;
  $('#setName').textContent=u.name;$('#setEmail').textContent=u.email;$('#setAva').textContent=ini;
  $('#wsName').value=DB.ws;$('#wsName2').textContent=DB.ws;$('#wsAva').textContent=DB.ws[0];
  const h=new Date().getHours(),g=h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  $('#greet').textContent=`${g}, ${u.name.split(' ')[0]}`;}
function toggleUserMenu(e){e.stopPropagation();$('#userMenu').classList.toggle('open');}
function closeUserMenu(){$('#userMenu').classList.remove('open');}
document.addEventListener('click',event=>{closeUserMenu();if(!event.target.closest('#bellDrop')&&!event.target.closest('#bellBtn'))$('#bellDrop').classList.remove('open');});

/* ============ LANDING ============ */
(function(){const items=['PDF','Notion','Confluence','Zendesk','Web pages','Google Docs','Sheets','Slack','Markdown','Intercom','REST API','Sitemap'];
const half=items.map(i=>`<span>${i} <b>/</b></span>`).join('');$('#mqTrack').innerHTML=`<span>TRAIN ON</span>${half}${half}`;})();

/* hero queue + grounding, tied to real chunk counts */
function renderQueue(){
  const rows=[['file','docs.docent.ai'],['doc','pricing.pdf'],['doc','faq.notion']];
  $('#qRows').innerHTML=rows.map((r,i)=>`<div class="q-row" id="qr${i}"><span class="q-ic">${icon(r[0],14)}</span><span class="fname">${r[1]}</span><span class="pbar"><i></i></span><span class="pct">0%</span><span class="ok">${icon('check',14)}</span></div>`).join('');
  [0,1,2].forEach(i=>{let p=0;const iv=setInterval(()=>{p=Math.min(100,p+rnd(14,30));
    const row=$('#qr'+i);if(!row){clearInterval(iv);return;}
    row.querySelector('.pbar i').style.width=p+'%';row.querySelector('.pct').textContent=p+'%';
    if(p>=100){clearInterval(iv);row.classList.add('done');
      if(i===2){$('#qDone').classList.add('on');$('#qCount').textContent=DB.demoSrc.chunks.length+' passages ready';}}},420+i*260);});
  $('#kbCount').textContent=DB.demoSrc.chunks.length;
}
/* landing chat on the real engine */
function pushMsg(box,who,html){const d=document.createElement('div');d.className='msg '+who;d.innerHTML=html;box.appendChild(d);box.scrollTop=box.scrollHeight;return d;}
function pushTyping(box){const d=document.createElement('div');d.className='msg bot typing';d.innerHTML='<i></i><i></i><i></i>';box.appendChild(d);box.scrollTop=box.scrollHeight;return d;}
function demoCompose(q){for(const it of INTENTS)if(it.re.test(q))return{t:it.t(DEMO_BOT),src:null};
  const hits=retrieve([{name:DB.demoSrc.name,chunks:DB.demoSrc.chunks}],q);
  if(!hits.length||hits[0].sc<0.3)return{t:'I could not find that in the Docent docs. Try asking about pricing, training, embedding or security.',src:null};
  const h=hits[0];const sent=h.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[h.text];
  let best=sent[0],bs=-1;const qt=[...new Set(tokens(q))];
  for(const s of sent){const sc=scoreChunk(qt,s);if(sc>bs){bs=sc;best=s;}}
  const idx=sent.indexOf(best);let ans=best.trim();if(sent[idx+1]&&ans.length<170)ans+=' '+sent[idx+1].trim();
  return{t:ans.slice(0,360),src:h.source};}
async function sendDemo(text){const box=$('#demoMsgs');pushMsg(box,'user',esc(text));
  const tp=pushTyping(box);await sleep(rnd(700,1300));tp.remove();
  const r=demoCompose(text);pushMsg(box,'bot',esc(r.t)+(r.src?`<span class="src">SOURCE: ${esc(r.src)}</span>`:''));}
function askDemo(t){if(S.view!=='landing')go('landing');sendDemo(t);}
$('#demoSend').onclick=()=>{const v=$('#demoInput').value.trim();if(!v)return;$('#demoInput').value='';sendDemo(v);};
$('#demoInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#demoSend').click();});
$('#btnWatch').onclick=async()=>{
  $('#heroWidget').scrollIntoView({behavior:'smooth',block:'center'});
  const script=['How fast can I get a bot live?','What happens if it cannot answer?'];
  for(const q of script){await sleep(500);await sendDemo(q);await sleep(900);}};
function recolorMini(c){$('#miniWgHead').style.background=c;}
function setBilling(yearly){$('#billM').classList.toggle('on',!yearly);$('#billY').classList.toggle('on',yearly);
 $$('.pv-m').forEach(e=>e.style.display=yearly?'none':'inline');$$('.pv-y').forEach(e=>e.style.display=yearly?'inline':'none');}
function toggleFaq(btn){const item=btn.parentElement,a=item.querySelector('.faq-a'),open=item.classList.contains('open');
 $$('.faq-item.open').forEach(o=>{o.classList.remove('open');o.querySelector('.faq-a').style.maxHeight=null;});
 if(!open){item.classList.add('open');a.style.maxHeight=a.scrollHeight+'px';}}
function countUp(el){const t=parseFloat(el.dataset.count),dec=+(el.dataset.dec||0),suf=el.dataset.suf||'',pre=el.dataset.pre||'',st=performance.now(),dur=1500;
 (function f(now){const p=Math.min(1,(now-st)/dur),e=1-Math.pow(1-p,3);
  el.textContent=dec?pre+(t*e).toFixed(dec)+suf:pre+Math.round(t*e).toLocaleString('en-US')+suf;
  if(p<1)requestAnimationFrame(f);})(st);}
const io=new IntersectionObserver(es=>{es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in');
 en.target.querySelectorAll('[data-count]').forEach(c=>{if(!c.dataset.done){c.dataset.done=1;countUp(c);}});
 io.unobserve(en.target);}});},{threshold:.18});
function watchReveals(){$$('.reveal').forEach(el=>io.observe(el));}

/* ============ CHARTS ============ */
function genSeries(n,base=420,vol=110){let v=base;return Array.from({length:n},()=>{v=Math.max(80,v+(Math.random()-.44)*vol);return Math.round(v);});}
function smoothPath(pts){if(pts.length<3)return pts.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join('');let d='M'+pts[0][0]+','+pts[0][1];
 for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],mx=(a[0]+b[0])/2;d+=`C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`;}return d;}
function sparkSVG(data,color,id){const w=140,h=34,mx=Math.max(...data),mn=Math.min(...data);
 const pts=data.map((v,i)=>[i/(data.length-1)*w,h-3-((v-mn)/(mx-mn||1))*(h-8)]);
 const line=smoothPath(pts);
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".25"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line}L${w},${h}L0,${h}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`;}
function barSVG(vals,labels,color,fmt){const w=560,h=190,pad=8,bw=(w-pad*2)/vals.length*.55,mx=Math.max(...vals)*1.12;
 const rects=vals.map((v,i)=>{const x=pad+i*(w-pad*2)/vals.length+((w-pad*2)/vals.length-bw)/2,bh=v/mx*(h-46),y=h-26-bh;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${color}" opacity="${(.5+.5*v/mx).toFixed(2)}"><title>${labels[i]}: ${fmt(v)}</title></rect><text x="${(x+bw/2).toFixed(1)}" y="${h-8}" text-anchor="middle" font-size="10" font-family="IBM Plex Mono" fill="#8aa396">${labels[i]}</text>`;}).join('');
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:190px">${rects}</svg>`;}
function donutHTML(segs,size=150,th=20,midB='',midL=''){const r=(size-th)/2,c=2*Math.PI*r;let off=0;
 const cs=segs.map(s=>{const len=c*s.v/100;const el=`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${th}" stroke-dasharray="${Math.max(0,len-3)} ${c-len+3}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size/2} ${size/2})"><title>${s.l}: ${s.v}%</title></circle>`;off+=len;return el;}).join('');
 return `<div class="donut-c"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${th}" opacity=".4"/>${cs}</svg><div class="dc-mid"><div><b>${midB}</b><span>${midL}</span></div></div></div>`;}

/* ============ APP ============ */
const TITLES={overview:'Overview',bots:'My agents',builder:'Agent builder',convos:'Conversations',analytics:'Analytics',sources:'Data sources',settings:'Settings'};
function showPanel(name){S.panel=name;
 $$('[data-panel]').forEach(p=>p.classList.toggle('on',p.dataset.panel===name));
 $$('#appNav .nav-it[data-go]').forEach(n=>n.classList.toggle('on',n.dataset.go===name));
 $('#topTitle').textContent=TITLES[name]||'Overview';
 if(name==='analytics')renderAnalytics();
 if(name==='builder')renderBuilder();
 if(name==='overview')renderOverview();
 window.scrollTo(0,0);}
$$('#appNav .nav-it[data-go]').forEach(b=>b.onclick=()=>showPanel(b.dataset.go));
$('#topSearch').addEventListener('input',e=>{const q=e.target.value.toLowerCase();
 if(S.panel==='convos')renderConvList(q);else if(S.panel==='sources')renderSourcesTable(q);});
function refreshApp(){applyUser();renderOverview();renderBots();renderConvList();renderThread();renderSourcesTable();renderTeam();renderNotifs();renderUsage();
 $('#todayLine').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})+' . Scout is your busiest agent today.';}
function renderUsage(){const used=DB.events.filter(e=>e.t==='msg'&&e.ts>Date.now()-30*864e5).length;
 $('#usageTxt').textContent=used.toLocaleString()+' / 20,000';$('#usageBar').style.width=Math.min(100,used/200)+'%';}

/* overview */
function dayBuckets(days){const out=Array(days).fill(0),res=Array(days).fill(0),now=Date.now();
 for(const e of DB.events){const d=Math.floor((now-e.ts)/864e5);if(d>=days)continue;
  if(e.t==='msg')out[days-1-d]++;else if(e.t==='res')res[days-1-d]++;}return{msg:out,res};}
function csat(botId){const f=DB.fb[botId]||{up:0,down:0};const tot=f.up+f.down;if(!tot)return 4.5;
 return Math.max(3.5,Math.min(5,4.3+(f.up-f.down*1.5)/tot*0.7));}
function renderOverview(){
  const b=dayBuckets(14);
  const totMsg=DB.events.filter(e=>e.t==='msg').length;
  const resN=DB.events.filter(e=>e.t==='res').length,escN=DB.events.filter(e=>e.t==='esc').length;
  const rate=Math.round(resN/(resN+escN)*100);
  const last7=DB.events.filter(e=>e.t==='msg'&&e.ts>Date.now()-7*864e5).length;
  const prev7=DB.events.filter(e=>e.t==='msg'&&e.ts>Date.now()-14*864e5&&e.ts<=Date.now()-7*864e5).length;
  const delta=prev7?Math.round((last7-prev7)/prev7*100):0;
  const users=new Set(DB.convos.map(c=>c.user)).size+1278;
  const avgCsat=(csat('b1')+csat('b2')+csat('b3'))/3;
  $('#statGrid').innerHTML=`
   <div class="stat"><div class="sl">Messages, all time</div><div class="sv">${totMsg.toLocaleString()}</div><span class="sd ${delta>=0?'up':'down'}">${delta>=0?'up':'down'} ${Math.abs(delta)}% wk</span><span class="spark">${sparkSVG(b.msg,'#177e51','sg1')}</span></div>
   <div class="stat"><div class="sl">Active users</div><div class="sv">${users.toLocaleString()}</div><span class="sd up">up 8.1%</span><span class="spark">${sparkSVG(genSeries(12,50,26),'#4d9de0','sg2')}</span></div>
   <div class="stat"><div class="sl">Resolution rate</div><div class="sv">${rate}%</div><span class="sd up">up 2.3%</span><span class="spark">${sparkSVG(b.res,'#f2a93b','sg3')}</span></div>
   <div class="stat"><div class="sl">CSAT score</div><div class="sv">${avgCsat.toFixed(1)}</div><span class="sd ${DB.fb.b1.down>3?'down':'up'}">live from feedback</span><span class="spark">${sparkSVG(genSeries(12,60,14),'#ee6c4d','sg4')}</span></div>`;
  drawMainChart();renderBotRow();renderRecent();renderUsage();
}
function ovSeries(){const days=S.range==='14d'?14:S.range==='30d'?30:90;let b=dayBuckets(days);
 if(days===90){const agg=(a)=>{const out=[];for(let i=0;i<a.length;i+=7)out.push(a.slice(i,i+7).reduce((x,y)=>x+y,0));return out;};
  return{msg:agg(b.msg),res:agg(b.res)};}return b;}
function drawMainChart(){const d=ovSeries(),w=600,h=200,mx=Math.max(...d.msg)*1.15;
 const P=arr=>arr.map((v,i)=>[i/(arr.length-1)*w,h-24-(v/mx)*(h-44)]);
 const pm=P(d.msg),pr=P(d.res);
 const svg=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#177e51" stop-opacity=".22"/><stop offset="1" stop-color="#177e51" stop-opacity="0"/></linearGradient></defs>
 <path d="${smoothPath(pm)}L${w},${h}L0,${h}Z" fill="url(#ovg)"/>
 <path d="${smoothPath(pr)}" fill="none" stroke="#f2a93b" stroke-width="2" stroke-dasharray="5 5" opacity=".8"/>
 <path d="${smoothPath(pm)}" fill="none" stroke="#177e51" stroke-width="2.5" stroke-linecap="round"/></svg>`;
 const box=$('#ovChart');box.querySelector('svg')?.remove();box.insertAdjacentHTML('afterbegin',svg);}
function setRange(btn){S.range=btn.dataset.range;$$('.rtabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');drawMainChart();}
$('#ovChart').addEventListener('mousemove',e=>{const r=$('#ovChart').getBoundingClientRect(),d=ovSeries(),n=d.msg.length;
 const i=Math.max(0,Math.min(n-1,Math.round((e.clientX-r.left)/r.width*(n-1))));
 const pct=i/(n-1)*100,mx=Math.max(...d.msg)*1.15;
 const days=S.range==='14d'?14:S.range==='30d'?30:90;const per=days/n;
 const dt=new Date(Date.now()-(n-1-i)*per*864e5).toLocaleDateString('en-US',{month:'short',day:'numeric'});
 $('#ovVline').style.opacity=1;$('#ovVline').style.left=pct+'%';
 $('#ovDot').style.opacity=1;$('#ovDot').style.left=pct+'%';$('#ovDot').style.top=`calc(${(1-d.msg[i]/mx)*78+6}%)`;
 const tip=$('#ovTip');tip.style.opacity=1;tip.style.left=pct+'%';tip.style.top='6%';
 tip.innerHTML=`${dt} . <b>${d.msg[i].toLocaleString()}</b> msgs . ${d.res[i].toLocaleString()} resolved`;});
$('#ovChart').addEventListener('mouseleave',()=>{['#ovVline','#ovTip','#ovDot'].forEach(s=>$(s).style.opacity=0);});
function botSrcCount(b){return DB.sources.filter(s=>s.botId===b.id).length;}
function renderBotRow(){$('#botRow').innerHTML=DB.bots.map(b=>`<div class="bot-mini" onclick="openBuilder('${b.id}')">
 <span class="bot-ava" style="background:${b.color}">${b.logo?`<img src="${esc(b.logo)}" alt="">`:esc(b.name[0])}</span>
 <div><b>${esc(b.name)} <span class="dot ${b.status==='live'?'dot-live':'dot-train'}"></span></b><span>${esc(b.desc.slice(0,32))}</span></div>
 <div class="bm-r"><b>${b.msgs?b.msgs.toLocaleString():'0'}</b>msgs</div></div>`).join('');}
function renderRecent(){$('#recentConvos').innerHTML=[...DB.convos].sort((a,b)=>b.ts-a.ts).slice(0,5).map(c=>{const last=c.msgs[c.msgs.length-1];
 const ago=Math.max(1,Math.round((Date.now()-c.ts)/60000))+'m';
 return `<div class="rc-row" onclick="openConvo('${c.id}')"><span class="avatar" style="background:${c.hue}">${initials(c.user)}</span>
 <div class="rt"><b>${esc(c.user)}</b><span>${esc(last.t)}</span></div>
 <span class="badge b-${c.status==='open'?'open':c.status==='resolved'?'res':'esc'}">${c.status}</span><time>${ago}</time></div>`;}).join('');}

/* bots */
function renderBots(){$('#botCount').textContent=DB.bots.length;
 $('#botGrid').innerHTML=DB.bots.map(b=>`<div class="bot-card">
  <div class="bc-top"><span class="bot-ava" style="background:${b.color};width:48px;height:48px;font-size:20px">${b.logo?`<img src="${esc(b.logo)}" alt="">`:esc(b.name[0])}</span>
  <div><h4>${esc(b.name)}</h4><span class="badge ${b.status==='live'?'b-live':'b-train'}"><span class="dot ${b.status==='live'?'dot-live':'dot-train'}"></span>${b.status}</span></div></div>
  <div class="bc-desc">${esc(b.desc)}</div>
  <div class="bc-stats"><div><b>${botSrcCount(b)}</b><span>sources</span></div><div><b>${b.msgs?b.msgs.toLocaleString():'0'}</b><span>messages</span></div><div><b>${b.status==='live'?csat(b.id).toFixed(1):'--'}</b><span>csat</span></div></div>
  ${b.status==='training'?`<div class="train-bar"><div class="pbar"><i style="width:${b.progress}%"></i></div><span>training . ${b.progress}%</span></div>`:''}
  <div class="bc-foot" style="margin-top:14px"><button class="btn btn-o btn-sm" onclick="openBuilder('${b.id}')"><span class="ic" data-ic="cog" data-s="14"></span> Builder</button>
  <button class="btn btn-g btn-sm" onclick="openBuilder('${b.id}');setTab(document.querySelector('[data-tab=embed]'))"><span class="ic" data-ic="code" data-s="14"></span> Embed</button></div></div>`).join('')
 +`<div class="bot-card bot-new" onclick="openBotModal()"><span class="plus">${icon('plus',22)}</span><b style="font-family:var(--disp);font-size:16px">New agent</b><span style="font-size:12.5px">Trained on your docs in minutes</span></div>`;
 hydrateIcons();}
function openBotModal(keep){S.mbColor='#177e51';if(!keep){$('#mbName').value='';$('#mbDesc').value='';$('#mbColor').value='#177e51';}
 $('#mbSrcs').innerHTML=DB.sources.map(s=>`<label class="msrc" onclick="this.classList.toggle('on')"><input type="checkbox" value="${s.id}"><span class="src-ic ${s.type}" style="width:30px;height:30px">${icon(s.type==='url'?'link':'doc',14)}</span>${esc(s.name)}</label>`).join('');
 $('#modalBot').classList.add('open');}
function closeBotModal(){$('#modalBot').classList.remove('open');}
$('#modalBot').addEventListener('click',e=>{if(e.target.id==='modalBot')closeBotModal();});
function createBot(){const name=$('#mbName').value.trim()||'Unnamed';
 const srcs=$$('#mbSrcs .msrc.on input').map(i=>i.value);
 const b={id:'b'+Date.now(),name,color:$('#mbColor').value,desc:$('#mbDesc').value.trim()||'Fresh out of the box. Add some sources.',status:'training',progress:8,msgs:0,welcome:`Hi, I am ${name}. Ask me anything.`};
 srcs.forEach(id=>{const s=DB.sources.find(x=>x.id===id);if(s)s.botId=b.id;});
 DB.bots.push(b);saveDB();closeBotModal();renderBots();renderBotRow();showPanel('bots');
 pushNotif(`${name} started training`);toast(`${name} is training`);
 const iv=setInterval(()=>{b.progress=Math.min(100,b.progress+rnd(12,26));saveDB();
  if(b.progress>=100){clearInterval(iv);b.status='live';saveDB();renderBots();renderBotRow();pushNotif(`${name} finished training and is live`);toast(`${name} is live and ready`);}else renderBots();},900);}
function curBotId(){return S.curBot;}
function deleteBotStep(btn){if(!btn.dataset.arm){btn.dataset.arm='1';btn.innerHTML='Confirm delete?';setTimeout(()=>{btn.dataset.arm='';btn.innerHTML=icon('trash',14)+' Delete agent';},2500);return;}
 const id=S.curBot;DB.bots=DB.bots.filter(b=>b.id!==id);DB.sources=DB.sources.filter(s=>s.botId!==id);
 DB.convos=DB.convos.filter(c=>c.botId!==id);delete DB.qas[id];delete DB.fb[id];saveDB();
 renderBots();renderBotRow();renderSourcesTable();showPanel('bots');toast('Agent and its data deleted');}

/* builder */
function openBuilder(id){S.curBot=id;showPanel('builder');}
function curBot(){return DB.bots.find(b=>b.id===S.curBot);}
function setTab(btn){$$('#bdTabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
 $$('.tabpane').forEach(p=>p.classList.toggle('on',p.dataset.pane===btn.dataset.tab));
 if(btn.dataset.tab==='test')initTestChat();}
function renderBuilder(){const b=curBot();if(!b)return;
 $('#bdId').innerHTML=`<span class="bot-ava" style="background:${b.color}">${b.logo?`<img src="${esc(b.logo)}" alt="">`:esc(b.name[0])}</span>
 <div><h3>${esc(b.name)} <span class="badge ${b.status==='live'?'b-live':'b-train'}"><span class="dot ${b.status==='live'?'dot-live':'dot-train'}"></span>${b.status}</span></h3><p>${esc(b.desc)}</p></div>`;
 renderSrcList();renderQA();renderEmbed();pvInit();renderDomains();}
function renderSrcList(){const b=curBot(),list=DB.sources.filter(s=>s.botId===b.id);
 $('#srcCountChip').textContent=list.length+' connected';
 $('#srcList').innerHTML=list.length?list.map(s=>`<div class="src-item"><span class="src-ic ${s.type}">${icon(s.type==='url'?'link':'doc',16)}</span>
  <div class="st"><b>${esc(s.name)}</b><span>${(s.chunks||[]).length} passages . ${s.size} . added ${s.added}</span></div>
  ${s.status==='indexing'?`<span class="badge b-train"><span class="dot dot-train"></span>indexing</span>`:`<span class="badge b-live">ready</span>`}
  <button class="rm" onclick="removeSource('${s.id}')" title="Remove">${icon('trash',15)}</button></div>`).join('')
  :'<p style="font-size:13px;color:var(--mut);padding:8px 4px">No sources yet. Upload a file or load the sample docs, and training starts automatically.</p>';
 $('#testSrcN').textContent=list.length;}
function indexSource(s,delay){s.status='indexing';saveDB();
 setTimeout(()=>{s.status='ready';saveDB();renderSrcList();renderSourcesTable();pushNotif(`${s.name} indexed (${(s.chunks||[]).length} passages)`);toast(`${s.name} indexed`);syncAgent(s.botId).catch(()=>{});},delay||2200);}
async function crawlWebsite(){
 const input=$('#crawlUrl'),button=$('#crawlButton'),status=$('#crawlStatus'),raw=input.value.trim();
 if(!raw){toast('Enter your website URL','x');input.focus();return;}
 let url;try{url=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);}catch(e){toast('Enter a valid website URL','x');return;}
 input.value=url.href;button.disabled=true;status.classList.add('on');button.setAttribute('aria-busy','true');
 try{
  const data=await api(`/api/agents/${encodeURIComponent(curBotId())}/crawl`,{method:'POST',body:JSON.stringify({url:url.href,maxPages:Number($('#crawlLimit').value)})});
  const origin=new URL(data.rootUrl).origin;
  DB.sources=DB.sources.filter(s=>{if(s.botId!==curBotId()||!s.url)return true;try{return new URL(s.url).origin!==origin;}catch(e){return true;}});
  const added=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
  for(const page of data.pages)DB.sources.push({...page,botId:curBotId(),added});
  const b=curBot();b.logo=data.brand.logo||b.logo;b.color=data.brand.primaryColor||b.color;
  if(/^(unnamed|support|new agent)$/i.test(b.name))b.name=`${data.brand.name} Assistant`;
  saveDB();renderSrcList();renderSourcesTable();renderBots();renderBotRow();renderBuilder();
  pushNotif(`${data.pages.length} pages trained from ${url.hostname}`);
  toast(`${data.pages.length} pages trained. Brand matched automatically.`);
  await syncAgent(curBotId());
 }catch(error){toast(error.message||'Could not crawl this website','x');}
 finally{button.disabled=false;button.removeAttribute('aria-busy');status.classList.remove('on');}
}
function handleFile(inp){const f=inp.files[0];inp.value='';if(!f)return;
 if(f.size>300000){toast('File too large for the demo (300KB max)','x');return;}
 const rd=new FileReader();rd.onload=()=>{const text=String(rd.result).slice(0,100000);
  const bot=curBot()&&S.panel==='builder'?curBot():DB.bots[0];
  const s={id:'s'+Date.now(),botId:bot.id,name:f.name,type:f.name.split('.').pop().toLowerCase().slice(0,4),size:(f.size/1024).toFixed(1)+' KB',added:'Jul 27',chunks:chunkText(text)};
  DB.sources.push(s);saveDB();indexSource(s);renderBots();};rd.readAsText(f);}
function openPasteModal(){$('#psName').value='';$('#psBody').value='';$('#modalPaste').classList.add('open');}
function addPasted(){const n=$('#psName').value.trim()||'pasted-notes.txt',body=$('#psBody').value.trim();
 if(body.length<40){toast('Paste at least a paragraph of text','x');return;}
 const s={id:'s'+Date.now(),botId:curBotId(),name:n,type:'txt',size:(body.length/1024).toFixed(1)+' KB',added:'Jul 27',chunks:chunkText(body)};
 DB.sources.push(s);saveDB();$('#modalPaste').classList.remove('open');indexSource(s);renderBots();}
function loadSamples(botId){const target=botId||DB.bots[0].id;let added=0;
 for(const doc of SAMPLE_DOCS){if(DB.sources.some(s=>s.name===doc.n))continue;
  DB.sources.push({id:'s'+Date.now()+added,botId:target,name:doc.n,type:doc.t,size:(doc.body.length/1024).toFixed(1)+' KB',status:'ready',added:'Jul 27',chunks:chunkText(doc.body)});added++;}
 saveDB();renderSrcList();renderSourcesTable();renderBots();
 syncAgent(target).catch(()=>{});toast(added?`${added} sample docs indexed`:'Sample docs already loaded');}
function removeSource(id){DB.sources=DB.sources.filter(s=>s.id!==id);saveDB();
 renderSrcList();renderSourcesTable();renderBots();syncAgent(curBotId()).catch(()=>{});toast('Source removed');}
function renderQA(){const list=DB.qas[S.curBot]||[];
 $('#qaList').innerHTML=list.length?list.map((qa,i)=>`<div class="qa-item"><div class="q"><span class="qtag">PINNED</span>${esc(qa.q)}</div><div class="a">${esc(qa.a)}</div>
 <div class="qa-foot"><button class="btn btn-g btn-xs" onclick="removeQA(${i})">${icon('trash',13)} Remove</button></div></div>`).join('')
 :'<p style="font-size:13px;color:var(--mut)">No pinned answers yet.</p>';}
function addQA(){const q=$('#qaQ').value.trim(),a=$('#qaA').value.trim();if(!q||!a){toast('Fill in both question and answer','x');return;}
 (DB.qas[S.curBot]=DB.qas[S.curBot]||[]).push({q,a});saveDB();$('#qaQ').value='';$('#qaA').value='';renderQA();syncAgent(S.curBot).catch(()=>{});toast('Answer pinned');}
function removeQA(i){DB.qas[S.curBot].splice(i,1);saveDB();renderQA();syncAgent(S.curBot).catch(()=>{});toast('Pinned answer removed');}
/* test chat, real engine */
function initTestChat(){const b=curBot();if(!b)return;
 $('#testHead').innerHTML=`<div class="wg-ava" style="background:rgba(255,255,255,.18);color:#fff">${b.name[0]}</div><div><div class="wg-name">${esc(b.name)}</div><div class="wg-sub"><span class="dot"></span> Test mode, not billed</div></div><span class="wg-tag">SANDBOX</span>`;
 $('#testHead').style.background=b.color;
 const box=$('#testMsgs');box.innerHTML='';pushMsg(box,'bot',esc(b.welcome));}
async function sendTest(){const inp=$('#testInput'),v=inp.value.trim();if(!v)return;inp.value='';
 const b=curBot();const box=$('#testMsgs');pushMsg(box,'user',esc(v));const tp=pushTyping(box);
 let r;try{await syncAgent(b.id);const data=await api(`/api/agents/${encodeURIComponent(b.id)}/chat`,{method:'POST',body:JSON.stringify({message:v})});
   r={t:data.answer,citations:data.citations||[]};}
 catch(error){r=respond(b,v);r.citations=r.src?[{source:r.src}]:[];}
 tp.remove();
 const refs=(r.citations||[]).slice(0,3).map((c,i)=>`${i+1}. ${esc(c.source)}`).join(' · ');
 pushMsg(box,'bot',esc(r.t)+(refs?`<span class="src">SOURCES: ${refs}</span>`:'')+
  `<div class="fb"><button onclick="fbClick(this,'up')">${icon('thumbUp',13)}</button><button onclick="fbClick(this,'down')">${icon('thumbDown',13)}</button></div>`);}
function fbClick(btn,dir){btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
 const f=DB.fb[S.curBot]=DB.fb[S.curBot]||{up:0,down:0};f[dir]++;saveDB();toast('Feedback logged. CSAT updated.');}
function clearTest(){initTestChat();toast('Test conversation reset');}
$('#testSend').onclick=sendTest;
$('#testInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendTest();});
/* appearance */
function pvInit(){const b=curBot();if(!b)return;$('#apName').value=b.name;$('#apColor').value=b.color;$('#apWelcome').value=b.welcome;pvUpdate();}
function setSwatch(c){$('#apColor').value=c;pvUpdate();}
function pvUpdate(){const b=curBot();if(!b)return;const name=$('#apName').value||b.name,color=$('#apColor').value,wel=$('#apWelcome').value;
 $('#pvHead').style.background=color;$('#pvAva').innerHTML=b.logo?`<img src="${esc(b.logo)}" alt="">`:esc((name[0]||'A').toUpperCase());$('#pvName').textContent=name;
 $('#pvWelcomeMsg').textContent=wel;
 $('#pvHead').closest('.widget').querySelector('.wg-send').style.background=color;}
function saveAppearance(){const b=curBot();b.name=$('#apName').value.trim()||b.name;b.color=$('#apColor').value;b.welcome=$('#apWelcome').value;
 saveDB();renderBots();renderBotRow();renderBuilder();syncAgent(b.id).catch(()=>{});toast('Appearance saved');}
/* embed */
function embedSnippet(b){return `<!-- Docent widget -->\n<script src="${location.origin}/embed.js"\n  data-agent="${b.id}"\n  data-color="${b.color}"\n  data-position="right" defer><\/script>`;}
function renderEmbed(){const b=curBot(),raw=embedSnippet(b);
 $('#embedCode').innerHTML=`<button class="copy" onclick="copyText(document.getElementById('embedCode').dataset.raw)">${icon('copy',13)} Copy</button>`+
  esc(raw).replace(/(data-[\w-]+)=/g,'<span class="at">$1</span>=');
 $('#embedCode').dataset.raw=raw;}
function copyEmbedGlobal(){copyText(embedSnippet(DB.bots[0]));}
function renderDomains(){$('#domainList').innerHTML=DB.domains.map((d,i)=>`<span class="chip">${esc(d)} <button style="display:inline-flex;color:var(--mut)" onclick="DB.domains.splice(${i},1);saveDB();renderDomains();syncAgent(curBotId()).catch(()=>{});toast('Domain removed')">${icon('x',11)}</button></span>`).join('');}
function addDomain(){const v=$('#domainInput').value.trim().toLowerCase();if(!v)return;if(!DB.domains.includes(v))DB.domains.push(v);saveDB();$('#domainInput').value='';renderDomains();syncAgent(curBotId()).catch(()=>{});toast('Domain allowlisted');}

/* conversations */
function setConvFilter(btn){S.convFilter=btn.dataset.cf;$$('#cfTabs button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderConvList();}
function renderConvList(q=''){const list=[...DB.convos].sort((a,b)=>b.ts-a.ts).filter(c=>(S.convFilter==='all'||c.status===S.convFilter)&&(!q||(c.user+c.msgs[c.msgs.length-1].t).toLowerCase().includes(q)));
 $('#convoCount').textContent=DB.convos.filter(c=>c.status!=='resolved').length;
 $('#convList').innerHTML=list.length?list.map(c=>{const last=c.msgs[c.msgs.length-1];const bot=DB.bots.find(b=>b.id===c.bot);
 const ago=Math.max(1,Math.round((Date.now()-c.ts)/60000))+'m';
 return `<div class="cv-row ${c.id===S.curConvo?'on':''}" onclick="openConvo('${c.id}')">
 <span class="avatar" style="background:${c.hue}">${initials(c.user)}</span>
 <div class="cvt"><b>${esc(c.user)}<time>${ago}</time></b><div class="prev">${esc(last.t)}</div>
 <div class="meta"><span class="badge b-${c.status==='open'?'open':c.status==='resolved'?'res':'esc'}">${c.status}</span>${bot?`<span class="chip"><span style="display:inline-block;width:8px;height:8px;border-radius:3px;background:${bot.color}"></span>${esc(bot.name)}</span>`:''}</div></div></div>`;}).join('')
 :'<p style="padding:26px;text-align:center;color:var(--mut);font-size:13px">Nothing here.</p>';}
function openConvo(id){S.curConvo=id;showPanel('convos');renderConvList();renderThread();}
function renderThread(){const c=DB.convos.find(x=>x.id===S.curConvo);if(!c){$('#threadHead').innerHTML='';$('#threadMsgs').innerHTML='<p style="color:var(--mut);font-size:13px">Select a conversation.</p>';return;}
 const bot=DB.bots.find(b=>b.id===c.bot);
 $('#threadHead').innerHTML=`<span class="avatar" style="background:${c.hue};width:40px;height:40px">${initials(c.user)}</span>
 <div><b>${esc(c.user)}</b><div class="meta">via website widget ${bot?'. '+esc(bot.name):''} . started ${Math.max(1,Math.round((Date.now()-c.ts)/60000))}m ago</div></div>
 <div class="thr-acts"><select class="inp sel" style="width:auto;padding:7px 34px 7px 12px;font-size:12.5px" onchange="setConvoStatus(this.value)">
 <option value="open" ${c.status==='open'?'selected':''}>Open</option><option value="resolved" ${c.status==='resolved'?'selected':''}>Resolved</option><option value="escalated" ${c.status==='escalated'?'selected':''}>Escalated</option></select>
 <button class="btn btn-p btn-sm" onclick="resolveConvo()">${icon('check',14)} Resolve</button></div>`;
 $('#threadMsgs').innerHTML=c.msgs.map(m=>`<div class="msg ${m.f}">${esc(m.t)}${m.src?`<span class="src">SOURCE: ${esc(m.src)}</span>`:''}</div>`).join('');
 $('#threadMsgs').scrollTop=1e6;}
function setConvoStatus(v){const c=DB.convos.find(x=>x.id===S.curConvo);c.status=v;saveDB();renderConvList();renderRecent();toast('Status updated');}
function resolveConvo(){setConvoStatus('resolved');logEvent('res');toast('Conversation resolved');}
function sendReply(){const inp=$('#threadReply'),v=inp.value.trim();if(!v)return;inp.value='';
 const c=DB.convos.find(x=>x.id===S.curConvo);c.msgs.push({f:'agent',t:v});saveDB();renderThread();renderConvList();renderRecent();}
$('#threadSend').onclick=sendReply;
$('#threadReply').addEventListener('keydown',e=>{if(e.key==='Enter')sendReply();});
function exportConvos(){const blob=new Blob([JSON.stringify(DB.convos,null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='docent-conversations.json';a.click();toast('Conversations exported');}
const VISITORS=['Jordan Lee','Sam Ortiz','Riley Chen','Casey Novak','Morgan Iqbal'];
const SIM_QS=['What is your refund policy?','How much does the Scale plan cost?','How do API rate limits work?','How do I export my data?','Can I book a demo?','Do you support SAML on Pro?'];
async function simulateVisitor(){const bot=DB.bots.find(b=>b.status==='live')||DB.bots[0];
 const user=VISITORS[rnd(0,VISITORS.length-1)];
 const hues=['#ee6c4d','#4d9de0','#8e6bd8','#177e51','#f2a93b'];
 const c={id:'c'+Date.now(),user,hue:hues[rnd(0,4)],botId:bot.id,ts:Date.now(),status:'open',msgs:[]};
 DB.convos.push(c);S.curConvo=c.id;showPanel('convos');renderConvList();renderThread();
 const qs=[...SIM_QS].sort(()=>Math.random()-.5).slice(0,rnd(2,3));
 for(const q of qs){c.msgs.push({f:'user',t:q});saveDB();renderThread();renderConvList();
  await sleep(rnd(900,1500));const r=respond(bot,q);c.msgs.push({f:'bot',t:r.t,src:r.src});
  logEvent('msg',bot.id);bot.msgs++;saveDB();renderThread();renderConvList();renderRecent();}
 pushNotif(`New conversation from ${user}`);toast(`Visitor simulated. ${bot.name} answered ${qs.length} questions from its sources.`);}

/* analytics */
function renderAnalytics(){
  const b=dayBuckets(28);const wd=[0,0,0,0,0,0,0];const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const now=Date.now();for(const e of DB.events){if(e.t!=='msg')continue;const d=Math.floor((now-e.ts)/864e5);if(d>=28)continue;
   wd[new Date(e.ts).getDay()]++;}
  $('#anBars').innerHTML=barSVG(wd,names,'#177e51',v=>v+' msgs');
  const resN=DB.events.filter(e=>e.t==='res').length,escN=DB.events.filter(e=>e.t==='esc').length;
  const tot=resN+escN||1;const rp=Math.round(resN/tot*100),ep=Math.min(18,Math.round(escN/tot*100)),hp=Math.max(0,100-rp-ep);
  $('#anDonut').innerHTML=donutHTML([{l:'Resolved by bot',v:rp,c:'#177e51'},{l:'Human handoff',v:hp,c:'#f2a93b'},{l:'Escalated',v:ep,c:'#ee6c4d'}],150,20,rp+'%','auto-resolved')
  +`<div class="dlegend"><div><i style="background:#177e51"></i>Resolved by bot<b>${rp}%</b></div><div><i style="background:#f2a93b"></i>Human handoff<b>${hp}%</b></div><div><i style="background:#ee6c4d"></i>Escalated<b>${ep}%</b></div></div>`;
  const counts={};for(const c of DB.convos)for(const m of c.msgs)if(m.f==='user'){const k=m.t.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();if(k.length>8)counts[k]=(counts[k]||0)+1;}
  let top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const seedQ=[['how do i upgrade my plan',9],['what is your refund policy',7],['api rate limits',5],['can i book a demo',4],['do you export data',3]];
  for(const [q,n] of seedQ){if(top.length>=5)break;if(!counts[q])top.push([q,n]);}
  top=top.slice(0,5);
  $('#topQ').innerHTML=top.map(([q,n],i)=>{const h=(q.charCodeAt(0)+q.length)%97;const res=88+h%11;
   return `<tr><td style="font-weight:600;text-transform:capitalize">${esc(q)}</td><td class="mono">${n*47+rnd(3,40)}</td><td class="tq-trend">${sparkSVG(genSeries(7,30+h%30,18),'#177e51','tq'+i)}</td><td><span class="badge b-live">${res}%</span></td></tr>`;}).join('')
   ||'<tr><td colspan="4" style="color:var(--mut)">Not enough messages yet.</td></tr>';}

/* sources panel */
function renderSourcesTable(q=''){const list=DB.sources.filter(s=>!q||s.name.toLowerCase().includes(q));
 $('#srcTable').innerHTML=list.map(s=>{const bot=DB.bots.find(b=>b.id===s.botId);
 return `<tr><td><div style="display:flex;gap:11px;align-items:center"><span class="src-ic ${s.type}">${icon(s.type==='url'?'link':'doc',15)}</span><span class="mono" style="font-size:12.5px">${esc(s.name)}</span></div></td>
 <td><span class="chip">${s.type}</span></td><td>${bot?`<span style="display:inline-flex;align-items:center;gap:7px"><span style="width:9px;height:9px;border-radius:3px;background:${bot.color}"></span>${esc(bot.name)}</span>`:'unassigned'}</td>
 <td class="mono" style="font-size:12px">${(s.chunks||[]).length}</td><td class="mono" style="font-size:12px;color:var(--mut)">${s.added}</td>
 <td>${s.status==='indexing'?`<span class="badge b-train"><span class="dot dot-train"></span>indexing</span>`:`<span class="badge b-live">ready</span>`}</td>
 <td style="text-align:right;white-space:nowrap"><button class="btn btn-g btn-xs" onclick="reindex(this,'${esc(s.name)}')">${icon('refresh',13)} Reindex</button>
 <button class="btn btn-g btn-xs" style="color:#c04426" onclick="removeSource('${s.id}')">${icon('trash',13)}</button></td></tr>`;}).join('')
 ||'<tr><td colspan="7" style="text-align:center;color:var(--mut);padding:30px">No sources match.</td></tr>';}
function reindex(btn,name){btn.style.pointerEvents='none';btn.querySelector('.ic').style.animation='spin 1s linear infinite';
 setTimeout(()=>{btn.style.pointerEvents='';btn.querySelector('.ic').style.animation='';toast(`${name} reindexed`);},1400);}

/* settings */
function saveWs(){DB.ws=$('#wsName').value.trim()||'Acme Inc.';saveDB();applyUser();toast('Workspace renamed');}
function renderTeam(){$('#teamCount').textContent=DB.team.length+' members';
 $('#teamList').innerHTML=DB.team.map(m=>`<div class="src-item"><span class="avatar" style="background:${m.hue}">${initials(m.n)}</span>
 <div class="st"><b style="font-family:var(--body);font-weight:600">${esc(m.n)}</b><span>${esc(m.e)}</span></div>
 <select class="inp sel" style="width:110px;padding:7px 30px 7px 10px;font-size:12.5px" onchange="toast('${esc(m.n)} is now '+this.value)" ${m.role==='Owner'?'disabled':''}>
 ${['Owner','Editor','Viewer'].map(r=>`<option ${r===m.role?'selected':''}>${r}</option>`).join('')}</select></div>`).join('');}
function inviteMember(){const e=$('#inviteEmail').value.trim();if(!e||!e.includes('@')){toast('Enter a valid email','x');return;}
 DB.team.push({n:e.split('@')[0].replace(/[._-]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),e,role:'Viewer',hue:['#177e51','#4d9de0','#ee6c4d','#f2a93b'][rnd(0,3)]});
 saveDB();$('#inviteEmail').value='';renderTeam();toast(`Invite sent to ${e}`);}

/* notifications */
function renderNotifs(){$('#notifList').innerHTML=DB.notifs.map((n,i)=>`<div class="notif ${n.read?'read':''}" onclick="DB.notifs[${i}].read=true;saveDB();renderNotifs()"><span class="nd"></span><div>${esc(n.t)}<time>${n.time}</time></div></div>`).join('');
 const unread=DB.notifs.filter(n=>!n.read).length;$('#bellBdg').style.display=unread?'grid':'none';$('#bellBdg').textContent=unread;}
function markRead(){DB.notifs.forEach(n=>n.read=true);saveDB();renderNotifs();toast('All caught up');}
$('#bellBtn').onclick=e=>{e.stopPropagation();$('#bellDrop').classList.toggle('open');};

/* ============ ADMIN ============ */
const ADM_TITLES={'a-overview':'Platform overview','a-users':'Users','a-bots':'All bots','a-billing':'Usage and billing','a-health':'System health','a-logs':'Audit log'};
function showAdmin(name){$$('[data-apanel]').forEach(p=>p.classList.toggle('on',p.dataset.apanel===name));
 $$('#admNav .nav-it[data-go]').forEach(n=>n.classList.toggle('on',n.dataset.go===name));
 $('#admTitle').textContent=ADM_TITLES[name];window.scrollTo(0,0);
 if(name==='a-billing')renderBilling();if(name==='a-health')renderHealth();if(name==='a-bots')renderAdmBots();}
$$('#admNav .nav-it[data-go]').forEach(b=>b.onclick=()=>showAdmin(b.dataset.go));
let admCounted=false;
function runAdminCounters(){if(admCounted)return;admCounted=true;$$('#view-admin [data-count]').forEach(c=>countUp(c));}
(function(){const d=genSeries(30,12000,2600),w=600,h=200,mx=Math.max(...d)*1.15;
 const pts=d.map((v,i)=>[i/(d.length-1)*w,h-20-(v/mx)*(h-40)]);
 $('#platChart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fe3b4" stop-opacity=".22"/><stop offset="1" stop-color="#8fe3b4" stop-opacity="0"/></linearGradient></defs>
 <path d="${smoothPath(pts)}L${w},${h}L0,${h}Z" fill="url(#pg)"/><path d="${smoothPath(pts)}" fill="none" stroke="#8fe3b4" stroke-width="2.5" stroke-linecap="round"/></svg>`;})();
const SIGNUPS=[['Kofi Mensah','Free','4m'],['Emma Dubois','Pro','31m'],['Nordform AB','Scale','2h'],['Hoshi K.K.','Scale','5h'],['Casa Verde','Free','8h']];
$('#signupsTable').innerHTML=SIGNUPS.map(s=>`<tr><td style="font-weight:600">${s[0]}</td><td><span class="badge b-${s[1].toLowerCase()}">${s[1]}</span></td><td class="mono" style="font-size:11.5px;color:var(--mut)">${s[2]} ago</td></tr>`).join('');
let tickI=0;const TICKS=['maya@acme.io created bot "Atlas"','felix@loopwell.com hit 20k messages this month','new signup from Berlin, DE','webhook endpoint verified for ws_hoshi','yuki@hoshi.jp upgraded to Scale','ingest pipeline drained queue, 0 pending'];
setInterval(()=>{if(S.view!=='admin')return;const el=$('#tickText');el.style.opacity=0;
 setTimeout(()=>{tickI=(tickI+1)%TICKS.length;el.textContent=TICKS[tickI];el.style.opacity=1;},300);},3400);
const ADM_USERS=[
 {n:'Maya Kapoor',e:'maya@acme.io',plan:'Pro',bots:3,msgs:'8.4k',joined:'Mar 2025',st:'active'},
 {n:'Felix Nguyen',e:'felix@loopwell.com',plan:'Scale',bots:12,msgs:'41k',joined:'Jan 2025',st:'active'},
 {n:'Sara Lindqvist',e:'sara@nordform.se',plan:'Pro',bots:4,msgs:'12k',joined:'Jun 2025',st:'active'},
 {n:'Kofi Mensah',e:'kofi@paystack.dev',plan:'Free',bots:1,msgs:'82',joined:'Jul 2026',st:'active'},
 {n:'Yuki Tanaka',e:'yuki@hoshi.jp',plan:'Scale',bots:9,msgs:'38k',joined:'Nov 2024',st:'active'},
 {n:'Emma Dubois',e:'emma@maison.fr',plan:'Pro',bots:2,msgs:'5.1k',joined:'Apr 2026',st:'active'},
 {n:'Omar Haddad',e:'omar@saharatech.ae',plan:'Free',bots:1,msgs:'14',joined:'Jul 2026',st:'suspended'},
 {n:'Grace Kim',e:'grace@seoulite.kr',plan:'Pro',bots:6,msgs:'19k',joined:'Feb 2026',st:'active'}];
function renderAdmUsers(q=''){const list=ADM_USERS.filter(u=>!q||(u.n+u.e).toLowerCase().includes(q));
 $('#admUsers').innerHTML=list.map((u,i)=>`<tr class="${u.st==='suspended'?'row-susp':''}">
 <td><div style="display:flex;gap:11px;align-items:center"><span class="avatar" style="background:hsl(${(i*67)%360} 45% 45%)">${initials(u.n)}</span><div><b style="display:block">${esc(u.n)}</b><span style="font-size:11.5px;color:var(--mut)">${esc(u.e)}</span></div></div></td>
 <td><span class="badge b-${u.plan.toLowerCase()}">${u.plan}</span></td><td class="mono">${u.bots}</td><td class="mono">${u.msgs}</td><td class="mono" style="font-size:12px;color:var(--mut)">${u.joined}</td>
 <td>${u.st==='active'?'<span class="badge b-live">active</span>':'<span class="badge b-esc">suspended</span>'}</td>
 <td style="text-align:right"><button class="btn ${u.st==='active'?'btn-d':'btn-o'} btn-xs" onclick="toggleUser(${ADM_USERS.indexOf(u)})">${u.st==='active'?'Suspend':'Enable'}</button></td></tr>`).join('');}
function toggleUser(i){ADM_USERS[i].st=ADM_USERS[i].st==='active'?'suspended':'active';
 renderAdmUsers($('#admSearch').value.toLowerCase());toast(ADM_USERS[i].st==='active'?'User re-enabled':'User suspended');}
$('#admSearch').addEventListener('input',e=>renderAdmUsers(e.target.value.toLowerCase()));
function renderAdmBots(){const mine=DB.bots.map(b=>({n:b.name,ws:DB.ws+' (you)',plan:'Pro',msgs:b.msgs?b.msgs.toLocaleString():'0',csat:b.status==='live'?csat(b.id).toFixed(1):'--',st:b.status}));
 const others=[{n:'Loopwell Support',ws:'Loopwell',plan:'Scale',msgs:'22.4k',csat:'4.7',st:'live'},
 {n:'Nordform FAQ',ws:'Nordform',plan:'Pro',msgs:'7.9k',csat:'4.5',st:'live'},{n:'Hoshi Helper',ws:'Hoshi',plan:'Scale',msgs:'18.1k',csat:'4.9',st:'live'},
 {n:'Maison Concierge',ws:'Maison',plan:'Pro',msgs:'3.3k',csat:'4.4',st:'training'},{n:'Paystack Pilot',ws:'PayStack',plan:'Free',msgs:'82',csat:'--',st:'live'}];
 $('#admBots').innerHTML=[...mine,...others].map(b=>`<tr><td style="font-weight:600"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${b.st==='live'?'var(--green)':'var(--amber)'};margin-right:9px"></span>${esc(b.n)}</td><td>${esc(b.ws)}</td><td><span class="badge b-${b.plan.toLowerCase()}">${b.plan}</span></td><td class="mono">${b.msgs}</td><td class="mono">${b.csat}</td><td><span class="badge ${b.st==='live'?'b-live':'b-train'}"><span class="dot ${b.st==='live'?'dot-live':'dot-train'}"></span>${b.st}</span></td></tr>`).join('');}
function renderBilling(){
 $('#revBars').innerHTML=barSVG([121,134,142,158,171,186],['Feb','Mar','Apr','May','Jun','Jul'],'#f2a93b',v=>'$'+v+'k');
 $('#planDonut').innerHTML=donutHTML([{l:'Free',v:58,c:'#4a6a5a'},{l:'Pro',v:33,c:'#f2a93b'},{l:'Scale',v:9,c:'#8fe3b4'}],150,20,'4.8k','workspaces')
 +`<div class="dlegend"><div><i style="background:#4a6a5a"></i>Free<b>58%</b></div><div><i style="background:#f2a93b"></i>Pro<b>33%</b></div><div><i style="background:#8fe3b4"></i>Scale<b>9%</b></div></div>`;
 const inv=[['INV-2094','Loopwell','$1,188.00','Jul 24','paid'],['INV-2093','Hoshi K.K.','$891.00','Jul 22','paid'],['INV-2092','Nordform AB','$356.00','Jul 18','paid'],['INV-2091','Maison','$267.00','Jul 12','due'],['INV-2090','Acme Inc.','$29.00','Jul 08','paid']];
 $('#invTable').innerHTML=inv.map(r=>`<tr><td class="mono" style="font-size:12px">${r[0]}</td><td style="font-weight:600">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono" style="font-size:12px;color:var(--mut)">${r[3]}</td><td class="mono inv-${r[4]}">${r[4]}</td></tr>`).join('');}
const SVCS=[{n:'Public API',lat:42},{n:'Ingestion pipeline',lat:310},{n:'Vector store',lat:12},{n:'Widget CDN',lat:28},{n:'Webhooks',lat:88}];
function renderHealth(){$('#svcList').innerHTML=SVCS.map((s,i)=>{const bars=Array.from({length:30},(_,j)=>`<i class="${(i===1&&j===17)||(i===4&&j===6)?'w':''}"></i>`).join('');
 return `<div class="svc"><b><span class="dot dot-live"></span>${s.n}</b><div class="upbars">${bars}</div>
 <span class="mono" style="font-size:11px;color:var(--mut)">99.9${rnd(5,9)}%</span><span class="lat"><b data-lat="${s.lat}">${s.lat}ms</b> p95</span></div>`;}).join('');}
setInterval(()=>{if(S.view!=='admin')return;$$('#svcList [data-lat]').forEach(el=>{const base=+el.dataset.lat;el.textContent=Math.max(4,base+rnd(-8,12))+'ms';});},2200);
const LOG_TPL=[
 ['info','bot b_8f3k2 answered in 1.2s (workspace acme)'],['info','ingest complete: pricing-page.pdf, 214 chunks'],
 ['warn','rate limit 80% for ws_loopwell (key sk_9f2)'],['info','new signup: kofi@paystack.dev (Free)'],
 ['info','widget loaded on app.nordform.se'],['err','webhook retry 3/5 to hooks.maison.fr (timeout)'],
 ['info','feedback logged on msg m_29f81'],['warn','vector store shard-7 latency 240ms'],
 ['info','plan upgraded: emma@maison.fr to Pro'],['info','handoff routed to #support (ws acme)'],
 ['err','ingest failed: broken redirect on help.saharatech.ae'],['info','daily digest sent to 4,812 owners']];
function logStamp(){return new Date().toTimeString().slice(0,8);}
function pushLog(init=false){if(S.logPaused&&!init)return;
 const [lv,msg]=LOG_TPL[rnd(0,LOG_TPL.length-1)];
 if(S.logFilter!=='all'&&lv!==S.logFilter&&!init)return;
 const feed=$('#logFeed');const line=document.createElement('div');line.className='log-line';line.dataset.lv=lv;
 line.innerHTML=`<time>${logStamp()}</time><span class="lv ${lv}">${lv.toUpperCase()}</span><span class="lm">${esc(msg)}</span>`;
 feed.appendChild(line);while(feed.children.length>70)feed.firstChild.remove();feed.scrollTop=feed.scrollHeight;}
function setLogFilter(btn){S.logFilter=btn.dataset.lf;$$('#lfChips button').forEach(b=>b.classList.remove('on'));btn.classList.add('on');
 $$('#logFeed .log-line').forEach(l=>{l.style.display=(S.logFilter==='all'||l.dataset.lv===S.logFilter)?'flex':'none';});}
function toggleLogPause(){S.logPaused=!S.logPaused;$('#logPause').textContent=S.logPaused?'Resume':'Pause';toast(S.logPaused?'Log stream paused':'Log stream resumed');}

/* ============ INIT ============ */
if(new URLSearchParams(location.search).get('demo')==='1')document.body.classList.add('demo-mode');
loadDB();hydrateIcons();watchReveals();
pushMsg($('#demoMsgs'),'bot','Hey. I am <b>Sofia</b>, Docent\'s support agent. I answer from the real Docent docs, with citations. Ask me anything.');
renderQueue();
for(let i=0;i<14;i++)pushLog(true);
setInterval(()=>{if(S.view==='admin')pushLog();},2600);
renderNotifs();renderBots();renderBotRow();renderRecent();renderConvList();renderThread();renderSourcesTable();renderTeam();renderAdmUsers();renderAdmBots();renderHealth();renderBilling();
drawMainChart();
if(DB.user){/* session persists; landing stays as entry */}
/* ambient: auth counter ticks with real event count */
setInterval(()=>{const el=$('#authCounter');if(!el||S.view!=='auth')return;
 const n=DB.events.filter(e=>e.t==='msg').length+rnd(0,3);el.textContent=n.toLocaleString();},2500);
$('#authCounter').textContent=DB.events.filter(e=>e.t==='msg').length.toLocaleString();
/* Nova finishes training shortly after load, for real */
(function(){const nova=DB.bots.find(b=>b.id==='b3');if(nova&&nova.status==='training'){
 const iv=setInterval(()=>{nova.progress=Math.min(100,(nova.progress||60)+rnd(4,9));saveDB();renderBots();
  if(nova.progress>=100){clearInterval(iv);nova.status='live';saveDB();renderBots();renderBotRow();pushNotif('Nova finished training and is live');toast('Nova is live and ready');}},1600);}})();
</script>
</body>
</html>
