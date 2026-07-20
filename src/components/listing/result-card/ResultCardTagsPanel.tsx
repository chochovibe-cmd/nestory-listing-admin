"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/listing/result-card/resultCardUi";
import { extractMissingCharacterNames } from "@/lib/characters/missingCharacterWarnings";
import { groupTagsByPrefix } from "@/lib/drafts/tagDisplayGroups";
import type { GradedWarning } from "@/lib/drafts/warningTiers";

/** S2: Tags／提醒分頁 — 從 ResultCard 展開區拆出。 */
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
  const tagGroups = useMemo(() => {
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return groupTagsByPrefix(tagList);
  }, [tags]);

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-tabpanel-grid">
        <div className="field">
          <label>
            Tags <CopyButton getValue={() => tags} />
          </label>
          <div className="rc-tags-grouped">
            {tagGroups.length === 0 ? (
              <span className="muted">尚無 Tags</span>
            ) : (
              tagGroups.map((group) => (
                <div className="rc-tag-group-row" key={group.key}>
                  <span className="rc-tag-group-label muted">{group.label}</span>
                  <div className="rc-tag-group-chips">
                    {group.tags.map((tag) => (
                      <span className="rc-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <input className="edit-input" onChange={(event) => onTagsChange(event.target.value)} value={tags} />
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
