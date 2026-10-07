"use client";

import Link from "next/link";
import { SchedulePublishPlanner } from "@/components/listing/SchedulePublishPlanner";
import styles from "./ScheduleCenterPreview.module.css";

export function ScheduleCenterPreview() {
  return (
    <section className={styles.wrap} aria-labelledby="schedule-preview-title">
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>UI/UX 2.0 PREVIEW</span>
          <h2 id="schedule-preview-title">📅 智慧排程上架</h2>
          <p>
            這一版先讓你確認操作方式；目前不寫排程資料、不跑 Cron，也不會把 Shopify 商品切成 ACTIVE。
          </p>
        </div>
        <Link className="nb-btn nb-btn--primary" href="/drafts/new?pane=results">
          到完成待發布選商品
        </Link>
      </div>

      <div className={styles.flow} aria-label="預定正式流程">
        <div><strong>1</strong><span>商品完成</span><small>ready</small></div>
        <span className={styles.arrow}>→</span>
        <div><strong>2</strong><span>建立 Shopify 草稿</span><small>DRAFT staging</small></div>
        <span className={styles.arrow}>→</span>
        <div><strong>3</strong><span>進排程池</span><small>每天固定配額</small></div>
        <span className={styles.arrow}>→</span>
        <div><strong>4</strong><span>發布前再檢查</span><small>sync / conflict</small></div>
        <span className={styles.arrow}>→</span>
        <div><strong>5</strong><span>正式公開</span><small>寫入發布批次</small></div>
      </div>

      <div className={styles.sectionHead}>
        <div>
          <h3>100 件怎麼排？</h3>
          <p>下面是可操作的正式版 UX 預覽。預設 20 件／天，你可以直接改日期、數量與星期。</p>
        </div>
      </div>

      <SchedulePublishPlanner draftCount={100} />

      <div className={styles.rules}>
        <article>
          <span>🔥</span>
          <div>
            <strong>熱門新品可插隊</strong>
            <p>正式版會提供「插隊今天」與「立即上架」，日配額不是死刑。</p>
          </div>
        </article>
        <article>
          <span>↻</span>
          <div>
            <strong>後來新增的往後排</strong>
            <p>已排好的日期不洗牌；新商品接在佇列尾端，避免原本時程一直變。</p>
          </div>
        </article>
        <article>
          <span>⚠</span>
          <div>
            <strong>排程後改商品會停下來</strong>
            <p>正式版若 Shopify sync 變成 dirty／conflict，該商品不自動公開舊版本。</p>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <strong>單件失敗不拖垮整批</strong>
            <p>成功的照常發布；失敗件回到「失敗重試」，可立即重試或排到下一天。</p>
          </div>
        </article>
      </div>
    </section>
  );
}
