import { useEffect } from 'react';
import { observeBody } from '@/lib/domObserver';

/**
 * Runtime repair for GBK-mojibake that leaked into historic database rows
 * (UTF-8 text decoded as GBK and stored back). Sources fixed at the code level
 * already; this covers legacy data until it is repaired with a one-off SQL pass.
 *
 * GBK mojibake is PAIRED: the second half of a multi-byte character fuses with
 * the following byte, so `’s` becomes `鈥檚` (one CJK char swallowing the "s").
 * Pair replacements must run before the single-character fallbacks, otherwise
 * a blanket `鈥 -> ’` turns em-dashes into apostrophes and leaves orphans.
 */
const replacements: Array<[RegExp, string]> = [
  // apostrophe pairs: ’ + following letter
  [/鈥檚/g, '’s'],
  [/鈥檛/g, '’t'],
  [/鈥檙/g, '’r'],
  [/鈥檓/g, '’m'],
  [/鈥檒/g, '’l'],
  [/鈥檇/g, '’d'],
  [/鈥檝/g, '’v'],
  // en-dash pairs: – + following capital (box letters A-F etc.)
  [/鈥揂/g, '–A'],
  [/鈥揃/g, '–B'],
  [/鈥揅/g, '–C'],
  [/鈥揇/g, '–D'],
  [/鈥揈/g, '–E'],
  [/鈥揊/g, '–F'],
  // truncated dash/ellipsis where the second byte was lost entirely
  [/鈥\?/g, '—'],
  // multiplication sign, middle dot, replacement-char noise
  [/脳/g, '×'],
  [/路/g, '·'],
  [/锟/g, ''],
  // any leftover lone lead byte reads best as an apostrophe
  [/鈥/g, '’'],
];

function repairText(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const current = node.nodeValue || '';
    // Fast reject: every mojibake form starts with one of these lead chars.
    if (!/[鈥路脳锟]/.test(current)) return;
    const next = replacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), current);
    if (next !== current) node.nodeValue = next;
  });
}

export function TextEncodingRepair() {
  useEffect(() => {
    const stopObserving = observeBody(() => repairText(document.body));
    return stopObserving;
  }, []);
  return null;
}
