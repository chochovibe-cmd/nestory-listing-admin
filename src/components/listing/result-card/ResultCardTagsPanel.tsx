"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/listing/result-card/resultCardUi";
import { extractMissingCharacterNames } from "@/lib/characters/missingCharacterWarnings";
import { groupTagsByPrefix, tagToneClass } from "@/lib/drafts/tagDisplayGroups";
import type { GradedWarning } from "@/lib/drafts/warningTiers";

function parseTagList(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function joinTagList(list: string[]): string {
  return list.join(", ");
}

/** S2: Tags／提醒分頁 — 從 ResultCard 展開區拆出。UX-B4-P01: 色分類／× 移除／＋新增。 */
export function ResultCardTagsPanel({
  tags,
  onTagsChange,
  warningSummary,
  blockWarnCount,
  confirmWarnCount,
  suggestWarnCount,
  ipName,
  quickAddingCharacter,
  regenerating,
  onQuickAddCharacter
}: {
  tags: string;
  onTagsChange: (value: string) => void;
  warningSummary: {
    block: GradedWarning[];
    confirm: GradedWarning[];
    suggest: GradedWarning[];
  };
  blockWarnCount: number;
  confirmWarnCount: number;
  suggestWarnCount: number;
  ipName: string | null | undefined;
  quickAddingCharacter: string | null;
  regenerating: boolean;
  onQuickAddCharacter: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const tagList = useMemo(() => parseTagList(tags), [tags]);
  const tagGroups = useMemo(() => groupTagsByPrefix(tagList), [tagList]);

  const removeTag = (tagToRemove: string) => {
    const next = tagList.filter((t) => t !== tagToRemove);
    onTagsChange(joinTagList(next));
  };

  const commitAdd = () => {
    const value = draft.trim();
    if (!value) {
      setAdding(false);
      setDraft("");
      return;
    }
    // Exact match after trim — do not force-prefix rewrite
    if (tagList.some((t) => t === value)) {
      setDraft("");
      setAdding(false);
      return;
    }
    onTagsChange(joinTagList([...tagList, value]));
    setDraft("");
    setAdding(false);
  };

  const cancelAdd = () => {
    setDraft("");
    setAdding(false);
  };

  const startAdd = () => {
    setAdding(true);
    setDraft("");
    // Focus after paint
    requestAnimationFrame(() => addInputRef.current?.focus());
  };

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-tabpanel-grid">
        <div className="field">
          <label>
            Tags <CopyButton getValue={() => tags} />
          </label>
          <div className="rc-tags-grouped">
            {tagGroups.length === 0 && !adding ? (
              <span className="muted">尚無 Tags</span>
            ) : (
              tagGroups.map((group) => (
                <div className="rc-tag-group-row" key={group.key}>
                  <span className="rc-tag-group-label muted">{group.label}</span>
                  <div className="rc-tag-group-chips">
                    {group.tags.map((tag) => {
                      const tone = tagToneClass(tag);
                      return (
                        <span className={tone ? `rc-tag ${tone}` : "rc-tag"} key={tag}>
                          {tag}
                          <button
                            aria-label={`移除 ${tag}`}
                            className="rc-tag-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeTag(tag);
                            }}
                            type="button"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            <div className="rc-tag-add-row">
              {adding ? (
                <span className="rc-tag-add-form">
                  <input
                    ref={addInputRef}
                    aria-label="新增 tag"
                    className="rc-tag-add-input edit-input"
                    onBlur={() => {
                      // Commit on blur if non-empty; otherwise cancel
                      if (draft.trim()) commitAdd();
                      else cancelAdd();
                    }}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitAdd();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelAdd();
                      }
                    }}
                    placeholder="角色_某某"
                    type="text"
                    value={draft}
                  />
                  <button
                    className="mini-btn rc-tag-add-confirm"
                    onMouseDown={(event) => {
                      // Prevent blur-before-click race
                      event.preventDefault();
                      commitAdd();
                    }}
                    type="button"
                  >
                    確認
                  </button>
                </span>
              ) : (
                <button className="rc-tag add" onClick={startAdd} type="button">
                  + 新增
                </button>
              )}
            </div>
          </div>
          <details className="rc-tags-raw-details">
            <summary className="muted">編輯完整字串</summary>
            <input
              className="edit-input"
              onChange={(event) => onTagsChange(event.target.value)}
              value={tags}
            />
          </details>
        </div>
        {blockWarnCount + confirmWarnCount + suggestWarnCount > 0 ? (
          <div className="rc-field">
            <div className="rc-label">提醒</div>
            {(
              [
                { key: "block", title: "⛔ 必修", items: warningSummary.block },
                { key: "confirm", title: "⚠ 待確認", items: warningSummary.confirm },
                { key: "suggest", title: "🔍 建議", items: warningSummary.suggest }
              ] as const
            ).map((group) =>
              group.items.length > 0 ? (
                <div className="rc-warn-group" key={group.key}>
                  <div className="rc-warn-group-title muted">{group.title}</div>
                  {group.items.map((w) => {
                    const missingFromLine = extractMissingCharacterNames([w.text]);
                    return (
                      <div className="rc-warning-line" key={`${group.key}-${w.text}`}>
                        <div
                          className={
                            group.key === "block"
                              ? "price-soft-warn rc-warn-line-block"
                              : group.key === "confirm"
                                ? "price-soft-warn"
                                : "muted"
                          }
                        >
                          {w.text}
                        </div>
                        {missingFromLine.map((name) => (
                          <Button
                            size="sm"
                            disabled={!ipName || quickAddingCharacter === name || regenerating}
                            key={`${w.text}-${name}`}
                            onClick={() => onQuickAddCharacter(name)}
                            type="button"
                          >
                            {quickAddingCharacter === name ? "新增中…" : `一鍵新增「${name}」`}
                          </Button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null
            )}
          </div>
        ) : (
          <div className="muted">目前沒有待確認提醒。</div>
        )}
      </div>
    </div>
  );
}
