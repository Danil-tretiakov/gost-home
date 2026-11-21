'use client';
import { useState } from 'react';

/** One script for actors: readable text with «Копировать» and «Скачать .txt». */
export default function ScriptCard({ n, title, text }: { n: number; title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const full = `${title}\n\n${text}`;
  async function copy() {
    try { await navigator.clipboard.writeText(full); }
    catch {
      const ta = document.createElement('textarea'); ta.value = full; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([full], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `Сценарий ${n} - ${title}`.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.txt';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  return <details className="script-card" open={n === 1}>
    <summary><span className="script-n">Сценарий {n}</span><span className="script-title">{title}</span></summary>
    <div className="script-body">{text}</div>
    <div className="script-actions"><button type="button" onClick={copy}>{copied ? 'Скопировано ✓' : 'Копировать'}</button><button type="button" onClick={download}>Скачать .txt</button></div>
  </details>;
}
