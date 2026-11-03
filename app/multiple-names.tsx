'use client';
import { useId } from 'react';
import { readShootValues, storeShootValues } from '../lib/shoot-values';

type Props = { label: string; itemLabel: string; value: string; onChange: (value: string) => void; suggestions: string[]; maxLength: number; canEdit: boolean };
export default function MultipleNames({ label, itemLabel, value, onChange, suggestions, maxLength, canEdit }: Props) {
  const listId = useId();
  const decoded = readShootValues(value);
  const names = decoded.length ? decoded : [''];
  const change = (index: number, next: string) => onChange(storeShootValues(names.map((name, i) => i === index ? next : name)));
  return <div className="multiple-names">
    <div className="multiple-label">{label}</div>
    {canEdit ? <>
      {names.map((name, index) => <div className="name-row" key={index}>
        <input aria-label={`${itemLabel} ${index + 1}`} list={listId} placeholder={`Название: ${itemLabel.toLowerCase()}`} maxLength={maxLength} value={name} onChange={e => change(index, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
        <button type="button" aria-label={`Удалить ${itemLabel === 'Локация' ? 'локацию' : 'проект'} ${index + 1}`} onClick={() => onChange(storeShootValues(names.filter((_, i) => i !== index)))}>×</button>
      </div>)}
      <datalist id={listId}>{suggestions.map(name => <option key={name} value={name} />)}</datalist>
      <button type="button" className="add-name" onClick={() => onChange(storeShootValues([...names, '']))}>＋ Добавить {itemLabel === 'Локация' ? 'локацию' : 'проект'}</button>
    </> : <div className="name-tags">{names.filter(name => name.trim()).length ? names.filter(name => name.trim()).map((name, index) => <span key={index}>{name}</span>) : <span>Не указано</span>}</div>}
  </div>;
}
