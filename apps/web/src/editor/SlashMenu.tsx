import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SlashItem } from './slash-command';

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, { items: SlashItem[]; command: (item: SlashItem) => void }>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          if (items[selected]) command(items[selected]);
          return true;
        }
        return false;
      }
    }));

    if (items.length === 0) {
      return <div className="slash-menu"><div className="slash-empty">无匹配命令</div></div>;
    }

    return (
      <div className="slash-menu">
        {items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            className={`slash-item${i === selected ? ' active' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
          >
            <span className="slash-icon">{item.icon}</span>
            <span className="slash-text">
              <b>{item.title}</b>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>
    );
  }
);

SlashMenu.displayName = 'SlashMenu';
