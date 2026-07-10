import { useEffect } from 'react';

const replacements: Array<[RegExp, string]> = [
  [/脳/g, '×'],
  [/路/g, '·'],
  [/鈥/g, '’'],
  [/锟/g, ''],
];

function repairText(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const current = node.nodeValue || '';
    const next = replacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), current);
    if (next !== current) node.nodeValue = next;
  });
}

export function TextEncodingRepair() {
  useEffect(() => {
    repairText(document.body);
    let pending = false;
    const observer = new MutationObserver((mutations) => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        mutations.forEach((mutation) => {
          if (mutation.target instanceof HTMLElement || mutation.target instanceof DocumentFragment) repairText(mutation.target);
          else if (mutation.target.parentNode) repairText(mutation.target.parentNode);
        });
      }, 40);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
