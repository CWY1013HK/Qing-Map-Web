# UI themes

Two complete chrome sets (badges + paper + 令牌 tablets):

| Theme | Path | Look |
|---|---|---|
| **silver** (default) | `silver/` | Greyscale silver badges + white/silver paper + **silver-metal 令牌** with coloured ribbons |
| **bronze** | `bronze/` | Aged bronze badges + golden paper + **ebony-wood 令牌** with coloured ribbons (original tablets) |

令牌 files per theme (all **575×1510** on silver — shared Handi height so ribbons are never cropped):

- `handi-lingpai.png` — crimson ribbon, 漢地十八省 (**base template**)
- `zhongguo-lingpai.png` — yellow ribbon, 中國疆域
- `hailu-lingpai.png` — cyan ribbon, 海路一覽

**Generating / regenerating:** follow [`.cursor/rules/lingpai-tablets.mdc`](../../.cursor/rules/lingpai-tablets.mdc). Always keep the Handi canvas size; change text + accent only.

Ebony originals are also archived as `public/intro/handi-lingpai-ebony.png` and `zhongguo-lingpai-ebony.png`.

Switch theme in [`src/config.ts`](../../src/config.ts) (`UI_THEME`). No end-user toggle.
