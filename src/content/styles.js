export const TOKENS = `
:host {
  all: initial;
  --blue: #16238f;
  --blue-deep: #0d1663;
  --fg: #d7dcea;
  --fg-dim: #b4bde3;
  --white: #ffffff;
  --yellow: #f4d65a;
  --cyan: #5cc3cc;
  --ink: #0b1150;
  --shadow: #000000;
  --label: "SL VT323", "VT323", ui-monospace, monospace;
  --text: "SL Plex Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  font: 12.5px/1.55 var(--text);
  color: var(--fg);
}
*, *::before, *::after { box-sizing: border-box; }
:focus-visible { outline: 2px solid var(--yellow); outline-offset: 1px; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
`;

export const INDICATOR_CSS = `${TOKENS}
.flag {
  position: relative; display: inline-block;
  font: 19px/1 var(--label); letter-spacing: 0.04em; color: var(--white);
  padding: 0 0 12px 4px;
  filter: drop-shadow(3px 3px 0 var(--shadow));
}
.cloth {
  display: block; background: var(--blue); padding: 4px 24px 3px 9px; white-space: nowrap;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 0 100%);
}
.pole { position: absolute; left: 0; top: -3px; bottom: 0; width: 4px; background: var(--shadow); }
.flag b { color: var(--yellow); font-weight: 400; margin-left: 7px; }
.flag:hover .cloth { background: var(--blue-deep); }
.flag.current .cloth { background: var(--yellow); color: var(--ink); }
.flag.current b { color: var(--blue); }
.flag:active { transform: translate(1px, 1px); }
.flag.big { font-size: 24px; padding: 0 0 14px 5px; }
.flag.big .cloth { padding: 5px 30px 4px 11px; clip-path: polygon(0 0, 100% 0, calc(100% - 13px) 50%, 100% 100%, 0 100%); }
.flag.big .pole { width: 5px; top: 0; }
.flag.big small { font-size: 18px; color: var(--fg); margin-left: 10px; }

dialog {
  padding: 0;
  border: 0;
  width: min(600px, calc(100vw - 32px));
  max-height: min(82vh, 760px);
  background: var(--blue);
  color: var(--fg);
  box-shadow: 8px 8px 0 var(--shadow);
  overflow: hidden;
}
dialog::backdrop { background: rgb(5 8 40 / 0.45); }
.screen { display: flex; flex-direction: column; max-height: inherit; }
.bar {
  display: flex; justify-content: space-between; gap: 16px;
  background: var(--cyan); color: var(--ink);
  font: 19px/1 var(--label); padding: 5px 12px 4px;
}
.bar span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { padding: 14px 16px 6px; overflow: auto; }
.lede { margin: 0 0 14px; color: var(--fg-dim); }
.source { margin: 0 0 18px; }
.source h3 { font: 22px/1.1 var(--label); color: var(--yellow); margin: 0 0 4px; font-weight: 400; }
.source h3 a { color: inherit; text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.meta { margin: 0; color: var(--fg-dim); }
.why { margin: 8px 0 0; padding: 0; list-style: none; }
.why li::before { content: "> "; color: var(--cyan); }
.same { margin: 10px 0 0; color: var(--fg-dim); }
.same b { color: var(--white); font-weight: 600; }
mark {
  display: block; margin: 6px 0 0; padding: 6px 8px;
  background: var(--blue-deep); color: var(--yellow);
  overflow-wrap: anywhere;
}
mark span { display: block; font: 16px/1 var(--label); color: var(--fg-dim); margin-bottom: 3px; }
.warn { margin: 8px 0 0; color: var(--yellow); }
.gaps { margin: 4px 0 14px; padding: 0; list-style: none; color: var(--fg-dim); }
.gaps li::before { content: "- "; }
h4 { font: 18px/1 var(--label); color: var(--white); margin: 14px 0 4px; font-weight: 400; }
.note { display: grid; gap: 4px; padding: 8px 16px 10px; border-top: 1px solid rgb(180 189 227 / 0.35); }
label { color: var(--fg-dim); }
textarea {
  font: inherit; color: var(--white); background: var(--blue-deep);
  border: 0; padding: 6px 8px; min-height: 44px; resize: vertical; width: 100%;
}
.keys {
  display: flex; flex-wrap: wrap; gap: 4px 18px;
  background: var(--blue-deep); padding: 6px 12px;
  font: 18px/1 var(--label);
}
.keys button { color: var(--fg); padding: 2px 0; }
.keys kbd { font: inherit; background: var(--fg); color: var(--ink); padding: 1px 5px 0; margin-right: 6px; }
.keys button:hover kbd { background: var(--yellow); }
.keys .own { margin-left: auto; color: var(--fg-dim); align-self: center; }
`;

export const CHIP_CSS = `${TOKENS}
.status {
  display: flex; align-items: center; gap: 2px;
  font: 18px/1 var(--label);
  background: var(--blue); padding: 4px 6px 4px 12px;
  box-shadow: 4px 4px 0 var(--shadow);
  max-width: calc(100vw - 32px);
}
.status[hidden] { display: none; }
.name { color: var(--cyan); margin-right: 12px; }
.text { color: var(--white); white-space: pre; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; }
.status button { background: var(--fg); color: var(--ink); padding: 3px 6px 1px; margin-left: 6px; }
.status button:hover { background: var(--white); }
.status button[hidden] { display: none; }
.status .allow { background: var(--yellow); }
.nav { display: flex; align-items: center; margin-left: 4px; }
.nav[hidden] { display: none; }
.nav .count { color: var(--yellow); margin: 0 2px 0 8px; min-width: 4ch; text-align: center; }
`;
