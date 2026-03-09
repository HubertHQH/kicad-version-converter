# KiCad 多版本文件格式差异研究报告（修订版）

> [!NOTE]
> 本报告基于 KiCad 源码和实际样例文件对比分析。
> 涵盖原理图文件（`.kicad_sch`）、符号库文件（`.kicad_sym`）、PCB 文件（`.kicad_pcb`）和封装文件（`.kicad_mod`）四种格式。
> 覆盖 KiCad 10、9、8、7 四个主要版本之间的格式差异。

## 背景

KiCad 使用 S-expression 格式保存原理图文件（`.kicad_sch`）、符号库文件（`.kicad_sym`）、PCB 文件（`.kicad_pcb`）和封装文件（`.kicad_mod`）。文件头的 `version` 字段用 `YYYYMMDD` 日期格式标识。
**KiCad 只保证向后兼容（新版可打开旧版），不支持向前兼容（旧版无法打开新版）。**
目前市面上**没有**任何现成的 KiCad 版本降级工具。

---

## 第零部分：KiCad 10 → KiCad 9 原理图格式差异

通过对比 KiCad 10 和 KiCad 9 的原理图文件，发现了以下**实际差异**：

### K10 差异 1: 文件头版本号

```diff
- (kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0"))
+ (kicad_sch (version 20260101) (generator "eeschema") (generator_version "10.0"))
```

### K10 差异 2: lib_symbol 新增属性

KiCad 10 在 lib_symbol 定义中新增了 `in_pos_files` 和 `duplicate_pin_numbers_are_jumpers` 属性，KiCad 9 没有这些属性：
```diff
 (symbol "Device:R"
+    (in_pos_files yes)
+    (duplicate_pin_numbers_are_jumpers no)
     (in_bom yes)
     (on_board yes)
     ...)
```

### K10 差异 3: property 节点新增 `show_name` 和 `do_not_autoplace`

KiCad 10 在 `property` 节点中新增了 `show_name` 和 `do_not_autoplace` 属性：
```diff
 (property "Reference" "R1"
     (at 0 0 0)
+    (show_name)
+    (do_not_autoplace)
     (effects ...))
```

### K10 差异 4: property 层级的 `hide` 位置变化 ⚠️ 关键

KiCad 10 将 `(hide yes)` 提升到 property 的直接子节点，而 KiCad 9 将其放在 `effects` 节点内部：
```
;; KiCad 10:
(property "Footprint" "..."
    (at 0 0 0)
    (hide yes)
    (effects
        (font (size 1.27 1.27))
    ))

;; KiCad 9:
(property "Footprint" "..."
    (at 0 0 0)
    (effects
        (font (size 1.27 1.27))
        (hide yes)
    ))
```

### K10 差异 5: symbol 实例新增 `body_style`

KiCad 10 在放置的 symbol 实例（非 lib_symbol 定义）中新增了 `(body_style ...)` 属性，KiCad 9 没有：
```diff
 (symbol
     (lib_id "Device:R")
     (at 100 50 0)
+    (body_style 1)
     (uuid "..."))
```

### K10 差异 6: `power` 节点新增 `global` 参数

KiCad 10 使用 `(power global)` 标记电源符号，KiCad 9 使用裸 `(power)`：
```diff
;; KiCad 10:
-(power global)

;; KiCad 9:
+(power)
```

### K10 差异 7: lib_symbol 新增 `body_styles` 节点

KiCad 10 在 lib_symbol 定义中新增了 `(body_styles ...)` 节点，KiCad 9 没有：
```diff
 (symbol "Device:R"
+    (body_styles
+        (body_style 1 "")
+    )
     (pin_names ...)
     ...)
```

### K10 差异 8: 空 pin 名称表示方式

KiCad 10 使用空字符串 `""` 表示未命名 pin，KiCad 9 使用波浪号 `"~"`：
```diff
;; KiCad 10:
-(name "" (effects ...))

;; KiCad 9:
+(name "~" (effects ...))
```

---

### K10 → K9 降级转换规则（N1-N8）

| 规则 | 说明 |
|------|------|
| N1 | 文件头降级: `version 20260101 → 20250114`，`generator_version "10.0" → "9.0"` |
| N2 | 移除 lib_symbol 中的 `(in_pos_files ...)`、`(duplicate_pin_numbers_are_jumpers ...)` |
| N3 | 移除 property 中的 `(show_name)` 和 `(do_not_autoplace)` |
| N4 | property 层级 `(hide yes)` → 移入 `effects` 内部（`(effects ... (hide yes))`） |
| N5 | 移除 symbol 实例中的 `(body_style ...)` |
| N6 | `(power global)` → `(power)`（移除 `global` 参数） |
| N7 | 移除 lib_symbol 中的 `(body_styles ...)` 节点 |
| N8 | lib_symbol pin 名 `(name "")` → `(name "~")`（空字符串 → 波浪号） |

---

## 第一部分：原理图 (.kicad_sch) KiCad 9 → KiCad 8 格式差异

通过对比 `asset/kicad9/` 和 `asset/kicad8/` 中的 video、flat_hierarchy、complex_hierarchy 等样例项目，发现了以下**实际差异**：

### 差异 1: 文件头版本号与生成器版本

```diff
- (kicad_sch (version 20231120) (generator "eeschema") (generator_version "8.0"))
+ (kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0"))
```

### 差异 2: `pin_names` 中的 `hide` 语法 ⚠️ 关键

KiCad 8 使用裸 `hide` 标记，与 `(offset)` 在同一行闭合括号内：
```
;; KiCad 8:
(pin_names
    (offset 1.016) hide)

;; KiCad 9:
(pin_names
    (offset 1.016)
    (hide yes)
)
```

### 差异 3: Pin 的 `hide` 语法 ⚠️ 关键

KiCad 8 使用裸 `hide` 标记跟在 `(length)` 后面：
```
;; KiCad 8:
(pin power_in line
    (at 0 0 90)
    (length 0) hide
    (name "GND" ...))

;; KiCad 9:
(pin power_in line
    (at 0 0 90)
    (length 0)
    (hide yes)
    (name "GND" ...))
```

### 差异 4: 符号库定义中的 `embedded_fonts` 属性

KiCad 9 在每个 `lib_symbols` 符号定义末尾新增了 `(embedded_fonts no)`，同时在文件末尾也有全局的 `(embedded_fonts no)`。KiCad 8 没有此属性。
```diff
;; KiCad 9 符号定义末尾:
        )
+       (embedded_fonts no)
    )

;; KiCad 9 文件末尾（sheet_instances 之后）:
    (sheet_instances ...)
+   (embedded_fonts no)
)
```

### 差异 5: Sheet pin 中 `uuid` 的位置

KiCad 9 将 `uuid` 放在 `effects` **之前**，KiCad 8 将 `uuid` 放在 `effects` **之后**：
```
;; KiCad 8:
(pin "CLKCDA" input
    (at 173.99 68.58 180)
    (effects
        (font (size 1.524 1.524))
        (justify left)
    )
    (uuid "6bc985e2-..."))

;; KiCad 9:
(pin "CLKCDA" input
    (at 173.99 68.58 180)
    (uuid "6bc985e2-...")
    (effects
        (font (size 1.524 1.524))
        (justify left)
    ))
```

### 差异 6: Sheet 元素新增属性

KiCad 9 在 `sheet` 中新增了 `exclude_from_sim`、`in_bom`、`on_board`、`dnp` 属性。KiCad 8 没有这些属性：
```diff
 (sheet
     (at 81.28 66.04)
     (size 41.91 43.18)
+    (exclude_from_sim no)
+    (in_bom yes)
+    (on_board yes)
+    (dnp no)
     (stroke ...)
     (fill ...)
     (uuid "...")
     ...)
```

### 差异 7: 符号库中图形元素排列顺序变化

KiCad 9 对 `symbol_0_1` 中的 `polyline` 和 `circle` 子元素进行了重新排序（先 polyline 后 circle → 某些情况下混合排序），以及 pin 在 `symbol_1_1` 中的排列顺序也有变化。这不影响功能但会导致文件差异。

### 差异 8: Image `(data ...)` 节点的行格式 ⚠️ 关键

原理图中嵌入的图片以 base64 编码存储在 `(image (data ...))` 节点中。数据被分割为多个带引号的字符串块（每块约 76 字符），**必须逐行书写**。如果所有块拼在同一行，会产生超过 180 万字符的超长行，导致 KiCad 8 报错 `maximum line length exceeded`。

```
;; 正确格式（每个 base64 块独占一行）:
(image
    (at 138.696 139.7)
    (scale 0.327907)
    (uuid "665bd6ed-...")
    (data
        "Qk3WeBQAAAAAADYAAAAo..."
        "AAADAQAAAP///wD///8A..."
        "////AP///wD///8A////..."
    )
)

;; 错误格式（所有块拼在同一行，约 1.86MB）:
(image
    ...
    (data "Qk3WeBQ..." "AAADAQAAA..." "////AP..." ... )  ← 超长行！
)
```

> [!NOTE]
> 此问题并非 KiCad 9 vs 8 的格式差异，而是**序列化器**在输出时未正确处理含大量字符串子节点的列表节点（如 `data`），将所有字符串拼在开头行上导致的。

---

## 完整版本历史（来自源码 `sch_file_versions.h`）

### KiCad 8 版本范围
KiCad 8 最终格式版本: **`20231120`** (generator_version; V8 cleanups)

### KiCad 9 新增格式版本（9.0 分支）

| 版本号 | 变更内容 | 降级难度 | 降级方式 |
|--------|----------|----------|----------|
| `20240101` | 表格 (Tables) | 🟡 中 | 移除 `(table ...)` 块 |
| `20240417` | 规则区域 (Rule Areas) | 🟢 低 | 移除 `(rule_area ...)` 块 |
| `20240602` | Sheet 属性（exclude_from_sim, in_bom, on_board, dnp） | 🟢 低 | 移除这些属性行 |
| `20240620` | 嵌入文件 (Embedded Files) | 🟡 中 | 移除 `(embedded_files ...)` 和 `(embedded_fonts ...)` |
| `20240716` | 多 Netclass 分配 | 🟢 低 | 保留第一个 netclass |
| `20240812` | Netclass 颜色高亮 | 🟢 低 | 移除颜色属性 |
| `20240819` | 嵌入文件哈希算法 (Murmur3) | 🟢 低 | 随嵌入文件一起处理 |
| `20241004` | `hide` 使用布尔值格式 | 🔴 高 | `(hide yes)` → `hide`；`(hide no)` → 移除 |
| `20241209` | SCH_FIELDs 私有标志 | 🟡 中 | 移除私有标志 |

### KiCad 10 新增格式版本（10.0 分支）

| 版本号 | 变更内容 | 降级难度 | 降级方式 |
|--------|----------|----------|----------|
| `20260101` | 文件头版本号升级 | 🟢 低 | 版本号降级 |
| — | lib_symbol 新增 `in_pos_files`、`duplicate_pin_numbers_are_jumpers` | 🟢 低 | 移除这些属性 |
| — | property 新增 `show_name`、`do_not_autoplace` | 🟢 低 | 移除这些属性 |
| — | property `hide` 位置提升到 property 层级 | 🟡 中 | 移回 effects 内部 |
| — | symbol 实例新增 `body_style` | 🟢 低 | 移除此属性 |
| — | `(power global)` 新语法 | 🟢 低 | 移除 `global` 参数 |
| — | lib_symbol 新增 `body_styles` 节点 | 🟢 低 | 移除此节点 |
| — | 空 pin 名用 `""` 替代 `"~"` | 🟢 低 | 空字符串替换为波浪号 |

---

## 降级转换规则详细定义

### 规则 1: 文件头降级
```
version 20250114 → 20231120
generator_version "9.0" → "8.0"
```

### 规则 2: `pin_names` 中的 hide 转换
```
输入:  (pin_names\n    (offset X)\n    (hide yes)\n)
输出:  (pin_names\n    (offset X) hide)
```
- 如果 `(hide no)`，则转为单纯的 `(pin_names\n    (offset X)\n)`

### 规则 3: Pin 的 hide 转换
```
输入:  (length L)\n    (hide yes)
输出:  (length L) hide
```
- 如果 `(hide no)`，则只保留 `(length L)`

### 规则 4: 移除 `embedded_fonts`
- 移除符号定义末尾的 `(embedded_fonts no)` 行
- 移除文件末尾的 `(embedded_fonts no)` 行

### 规则 5: Sheet pin uuid 位置还原
```
输入:
(pin "NAME" type
    (at X Y R)
    (uuid "UUID")
    (effects ...))

输出:
(pin "NAME" type
    (at X Y R)
    (effects ...)
    (uuid "UUID"))
```

### 规则 6: 移除 Sheet 新增属性
从 `(sheet ...)` 中移除以下行:
- `(exclude_from_sim no)`
- `(in_bom yes)`
- `(on_board yes)`
- `(dnp no)`

### 规则 7: 移除 KiCad 9 特有元素
- 移除整个 `(table ...)` 块
- 移除整个 `(rule_area ...)` 块
- 移除整个 `(embedded_files ...)` 块

### 规则 8: 图形元素排序（可选）
KiCad 8 不强制要求特定排序，元素顺序不同不影响加载。可以跳过此规则。

### 规则 9: 序列化行长度控制
当一个 S-expression 列表节点包含大量连续的 atom/string 子节点（如 `(data ...)` 中的 base64 块）时，序列化器**必须逐行输出**每个子节点，而不是将它们全部拼在开头行上。

阈值：当连续 atom/string 子节点数量 > 6 时，切换为逐行输出模式。
```
;; 正常节点（≤6 个参数），保持单行:
(at 138.696 139.7)
(uuid "665bd6ed-...")

;; 大量字符串节点（>6 个参数），逐行输出:
(data
    "chunk1..."
    "chunk2..."
    ...
)
```

---

## 技术实现方案

### 核心架构

```
输入: KiCad 10/9 .kicad_sch / .kicad_sym / .kicad_pcb / .kicad_mod 文件
          │
          ▼
   ┌──────────────────┐
   │ S-expression 解析 │  ← 解析为 AST 节点树
   │   (Tokenizer +    │
   │    Parser)        │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────────────────────┐
   │   文件类型检测 + 版本检测          │
   │   kicad_sch → 原理图规则          │
   │   kicad_symbol_lib → 符号库规则   │
   │   kicad_pcb → PCB 规则            │
   │   footprint → 封装规则            │
   └────────┬─────────────────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
 ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │ 原理图   │  │ 符号库    │  │   PCB    │  │  封装    │
 │ N1-N8   │  │ N1-N8   │  │         │  │         │  ← K10→K9 转换
 │ R1-R8   │  │ S1-S4   │  │ P1-P9   │  │ F1-F4   │  ← K9→K8 转换
 │ R10-R15 │  │ S10-S14 │  │ P10-P26 │  │ F10-F18 │  ← K8→K7 转换
 └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
      └──────────┬──────────────┴─────────────┘
             ▼
   ┌──────────────────┐
   │ S-expression 序列化│  ← 保持 KiCad 缩进风格
   │   (Pretty Print)  │
   └────────┬─────────┘
            │
            ▼
   输出: KiCad 9/8/7 兼容文件
```

> [!NOTE]
> PCB 文件使用独立的转换模块 `pcb-converter.js`，封装文件使用 `fp-converter.js`，均共享相同的 S-expression 解析器和统一转换入口。
> KiCad 10 → KiCad 9 的转换目前支持原理图和符号库文件（N 系列规则），PCB 和封装文件仅做文件头降级。

### 实现语言: JavaScript/Node.js

与现有的 kicadversionparser 项目保持一致。

### S-expression 解析器设计

需要一个**保留格式信息**的 S-expression 解析器:
- 解析 `(token arg1 arg2 (child1 ...) (child2 ...))` 结构
- 每个节点包含: `name` + `args` + `children[]` 
- 解析器需要处理带引号字符串和数字类型
- **关键**: 序列化时需要还原 KiCad 的缩进风格（tab 缩进）

### 处理流程

1. 读取 `.kicad_sch` 文件内容
2. 解析为 S-expression AST
3. 递归遍历 AST，按规则进行转换
4. 序列化 AST 为文本
5. 写入输出文件

### 风险和局限

> [!WARNING]
> - **有损转换**: 表格、规则区域、嵌入文件等 K9/K10 特有功能在降级时**丢失**
> - ~~**符号库文件**: `.kicad_sym` 符号库文件也有版本差异，需要单独处理~~ ✅ 已实现
> - ~~**PCB 文件**: `.kicad_pcb` 文件也有类似的版本问题~~ ✅ 已实现
> - ~~**封装文件**: `.kicad_mod` 封装文件也需要降级处理~~ ✅ 已实现
> - ~~**KiCad 10 支持**: 需要支持 KiCad 10 文件的降级转换~~ ✅ 已实现（原理图/符号库 N1-N8 规则）
> - **多 Sheet 项目**: 每个 `.kicad_sch` 文件都需要单独转换
> - **项目文件**: `.kicad_pro` 项目文件也需要版本降级处理
> - **行长度限制**: KiCad 8 对单行长度有限制，嵌入图片的 base64 数据需逐行输出。
> - **KiCad 10 PCB/封装**: K10 的 PCB 和封装文件目前仅做文件头降级，尚未研究详细格式差异。

> [!IMPORTANT]
> 该工具的目标是"尽力降级"——保留所有核心电路信息（连接性、元器件、值、位置），安全移除或转换新版本新增的非关键格式特性。支持从 KiCad 10 一路降级到 KiCad 7。

---

## 第二部分：符号库 (.kicad_sym) 格式差异

通过对比 `asset/kicad9/Symbol_v9/`、`asset/kicad8/Symbol_v8/`、`asset/kicad7/Symbol_v7/` 中的 `Buffer.kicad_sym` 和 `power.kicad_sym` 样例文件，总结出以下三个版本之间的差异。

### 三版本核心差异对照表

| 差异点 | KiCad 9 | KiCad 8 | KiCad 7 |
|--------|---------|---------|--------|
| 根节点 | `(kicad_symbol_lib` | `(kicad_symbol_lib` | `(kicad_symbol_lib` |
| version | `20241209` | `20231120` | `20220914` |
| generator | `"kicad_symbol_editor"` | `"kicad_symbol_editor"` | `kicad_symbol_editor`（无引号） |
| generator_version | `"9.0"` | `"8.0"` | ❌ 不存在 |
| `pin_names` hide | `(pin_names (offset 0) (hide yes))` | `(pin_names (offset 0) hide)` | `(pin_names (offset 0))`（无 hide） |
| `pin_numbers` hide | `(pin_numbers (hide yes))` | `(pin_numbers hide)` | ❌ 不存在 |
| pin 级 hide | `(hide yes)` 独立子节点 | `(length N) hide` 裸标记 | `(length N) hide` 裸标记 |
| `embedded_fonts` | 每个符号末尾含 `(embedded_fonts no)` | ❌ 不存在 | ❌ 不存在 |
| `exclude_from_sim` | ✅ | ✅ | ❌ 不存在 |
| Description 属性 | `(property "Description" ...)` | `(property "Description" ...)` | `(property "ki_description" ...)` |
| effects 中 hide | `(hide yes)` | `(hide yes)` | `hide`（裸原子） |

### 符号库差异 1: 文件头

```diff
;; KiCad 9:
 (kicad_symbol_lib
     (version 20241209)
     (generator "kicad_symbol_editor")
     (generator_version "9.0")

;; KiCad 8:
 (kicad_symbol_lib
     (version 20231120)
     (generator "kicad_symbol_editor")
     (generator_version "8.0")

;; KiCad 7:
-(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)
+;; 注意: 无 generator_version，generator 无引号，更紧凑的单行格式
```

### 符号库差异 2: `pin_names` / `pin_numbers` hide（以 power 符号为例）

```
;; KiCad 9:
(pin_numbers
    (hide yes)
)
(pin_names
    (offset 0)
    (hide yes)
)

;; KiCad 8:
(pin_numbers hide)
(pin_names
    (offset 0) hide)

;; KiCad 7:
;; 无 pin_numbers 节点
(pin_names (offset 0))
;; hide 标记在 pin 级别: (pin ... (length 0) hide ...)
```

### 符号库差异 3: `embedded_fonts`

```diff
;; KiCad 9 每个符号定义末尾:
    (symbol "CDCV304")
        ...
+       (embedded_fonts no)
    )

;; KiCad 8/7: 无此节点
```

### 符号库差异 4: `exclude_from_sim`

```diff
;; KiCad 8/9:
 (symbol "CDCV304"
+    (exclude_from_sim no)
     (in_bom yes)
     (on_board yes)
     ...)

;; KiCad 7:
 (symbol "CDCV304" (in_bom yes) (on_board yes)
     ...)
```

### 符号库差异 5: Description 属性名

```diff
;; KiCad 8/9:
 (property "Description" "0-200 MHz 1:4 Clock Buffer...")

;; KiCad 7:
-(property "ki_description" "0-200 MHz 1:4 Clock Buffer...")
```

### 符号库差异 6: effects 中的 hide/bold/italic 语法

```
;; KiCad 8/9:
(effects
    (font (size 1.27 1.27))
    (hide yes)
)

;; KiCad 7:
(effects (font (size 1.27 1.27)) hide)
```

---

## 符号库降级转换规则

### K9 → K8 规则（S1-S4）

| 规则 | 说明 |
|------|------|
| S1 | 文件头降级: `version 20241209 → 20231120`，`generator_version "9.0" → "8.0"` |
| S2 | `pin_names`/`pin_numbers` 中 `(hide yes)` → 裸 `hide` |
| S3 | `pin` 中 `(hide yes)` → 裸 `hide` |
| S4 | 移除每个符号末尾的 `(embedded_fonts no)` |

### K8 → K7 规则（S10-S14）

| 规则 | 说明 |
|------|------|
| S10 | 文件头降级: `version → 20220914`，移除 `generator_version`，`generator` 去引号 |
| S11 | 递归移除所有 `(exclude_from_sim ...)` 节点 |
| S12 | `(property "Description" ...)` → `(property "ki_description" ...)` |
| S13 | `(hide yes)`/`(bold yes)`/`(italic yes)` → 裸原子 |
| S14 | 移除 `(pin_numbers hide)` 节点；`pin_names` 中移除 `hide` 标记 |

---

## 第三部分：PCB (.kicad_pcb) 格式差异

通过对比 `asset/kicad9/` 和 `asset/kicad8/` 中的 video、pic_programmer 等包含 PCB 的样例项目，总结出以下版本差异。

### PCB 差异 1: 文件头版本号

```diff
- (kicad_pcb (version 20240108) (generator "pcbnew") (generator_version "8.0"))
+ (kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0"))
```

### PCB 差异 2: 层 ID 编号方案 ⚠️ 关键

KiCad 9 使用新的层编号方案（偶数为铜层，奇数为非铜层），KiCad 8 使用传统的 0-49 编号。

```diff
;; KiCad 9 层定义:
 (layers
     (0 "F.Cu" signal)         ;; 0 → 0 (不变)
     (2 "B.Cu" signal)         ;; 2 → 31
     (1 "F.Mask" user)         ;; 1 → 39
     (3 "B.Mask" user)         ;; 3 → 38
     (5 "F.SilkS" user)        ;; 5 → 37
     ...

;; KiCad 8 层定义:
 (layers
     (0 "F.Cu" signal)
     (31 "B.Cu" signal)
     (39 "F.Mask" user)
     (38 "B.Mask" user)
     (37 "F.SilkS" user)
     ...
```

### PCB 差异 3: `embedded_fonts` ⚠️ 关键

KiCad 9 在**顶层**和**每个 footprint 内部**都添加了 `(embedded_fonts no)`。KiCad 8 不支持这个属性（尤其是 footprint 内的）。

```diff
;; KiCad 9 顶层:
    (embedded_fonts no)

;; KiCad 9 footprint 内部:
    (footprint "xxx"
        ...
        (pad "2" ...)
+       (embedded_fonts no)      ← K8 不认识！
        (model ...)
    )
```

### PCB 差异 4: `layerselection` 位掩码格式

KiCad 9 使用 128 位格式（4 段），KiCad 8 使用紧凑格式（2 段）：

```diff
;; KiCad 9:
- (layerselection 0x00000000_00000000_000010fc_ffffffff)

;; KiCad 8:
+ (layerselection 0x10fc_ffffffff)
```

### PCB 差异 5: `tenting` vs `viasonmask`

KiCad 9 在 `setup` 中使用 `(tenting front back)` 替代了 KiCad 8 的 `pcbplotparams` 中的 `(viasonmask no)`：

```diff
;; KiCad 9 setup:
+ (tenting front back)

;; KiCad 8 pcbplotparams:
+ (viasonmask no)
```

### PCB 差异 6: pcbplotparams 参数变化

KiCad 9 新增了多个 pcbplotparams 参数，同时移除了部分 KiCad 8 的参数：

**K9 新增（需移除）**:
- `pdf_metadata`、`pdf_single_document`
- `plotpadnumbers`、`hidednponfab`、`sketchdnponfab`、`crossoutdnponfab`
- `plot_black_and_white`

**K8 参数（K9 中已删除，需恢复）**:
- `plotreference yes`、`plotvalue yes`、`plotfptext yes`

### PCB 差异 7: Dimension style 中的 `arrow_direction` ⚠️ 关键

KiCad 9 在 dimension 的 `style` 节点中新增了 `(arrow_direction outward)`，并将 `keep_text_aligned` 从裸原子改为列表形式：

```diff
;; KiCad 8 dimension style:
 (style
     (thickness 0.2)
     (arrow_length 1.27)
     (text_position_mode 0)
     (extension_height 0.58642)
     (extension_offset 0) keep_text_aligned)

;; KiCad 9 dimension style:
 (style
     (thickness 0.2)
     (arrow_length 1.27)
     (text_position_mode 0)
+    (arrow_direction outward)     ← K8 不支持！
     (extension_height 0.58642)
     (extension_offset 0)
-    keep_text_aligned)
+    (keep_text_aligned yes))      ← K8 期望裸原子
```

### PCB 差异 9: Zone 中的 `placement` 属性 ⚠️ 关键

KiCad 9 在 zone 定义中新增了 `(placement ...)` 子节点，用于多通道（multi-channel）自动放置区域功能。KiCad 8 不支持此属性，解析时会报错。

```diff
;; KiCad 9 zone 定义:
 (zone
     (net 0)
     (net_name "")
     (layers "F.Cu" "B.Cu")
     (uuid "32086486-...")
     (name "auto-placement-area-/CH4/")
     (hatch none 0.5)
     (keepout ...)
+    (placement                     ← K8 不支持！
+        (enabled yes)
+        (sheetname "/CH4/")
+    )
     (fill ...)
     (polygon ...)
 )

;; KiCad 8: 无 (placement) 节点
```

### PCB 差异 10: pad teardrops 中 `curved_edges` 重命名 ⚠️ 关键

KiCad 9 将 pad teardrops 中的 `curve_points` 参数重命名为 `curved_edges`。KiCad 8 不认识 `curved_edges`，会导致解析报错。

```diff
;; KiCad 9 pad teardrops:
 (teardrops
     (best_length_ratio 0.5)
     (max_length 1)
     (best_width_ratio 1)
     (max_width 2)
-    (curve_points 0)
+    (curved_edges no)              ← K8 不认识！
     (filter_ratio 0.9)
     (enabled yes)
     (allow_two_segments yes)
     (prefer_zone_connections yes)
 )

;; KiCad 8: 使用 (curve_points N)
```

### PCB 差异 8: K8 → K7 格式变化

KiCad 8 和 KiCad 7 之间的 PCB 格式差异更大：

| 差异点 | KiCad 8 | KiCad 7 |
|--------|---------|--------|
| ID 标识符 | `(uuid "xxx")` | `(tstamp xxx)` |
| 参考标识 | `(property "Reference" ...)` | `(fp_text reference ...)` |
| 值 | `(property "Value" ...)` | `(fp_text value ...)` |
| Datasheet/Description | `(property "Datasheet"/"Description" ...)` | 不存在 |
| 图纸信息 | `(sheetname "...")` / `(sheetfile "...")` | `(property "Sheetname" "...")` |
| 锁定状态 | `(locked yes)` 子节点 | footprint 行裸 `locked` 原子 |
| generator_version | 存在 | 不存在 |
| pcbplotparams 布尔值 | `yes`/`no` | `true`/`false` |
| pad remove_unused_layers | `(remove_unused_layers no/yes)` | 裸 `(remove_unused_layers)` 或不存在 |
| pad keep_end_layers | `(keep_end_layers no/yes)` | 裸 `(keep_end_layers)` 或不存在 |
| pad pintype/pinfunction | `(pintype "...")` / `(pinfunction "...")` | 不存在 |
| 自定义 property | 支持任意自定义属性（如 `Champ4`） | 仅支持 `ki_fp_filters`、`Sheetname`、`Sheetfile` |
| property 中 hide | `(hide yes)` 列表形式 | 裸 `hide` 原子 |
| effects 中 bold/italic | `(bold yes)` / `(italic yes)` | 裸 `bold` / `italic` 原子 |
| 图形填充值 | `(fill no)` / `(fill yes)` | `(fill none)` / `(fill yes)` — K7 不接受 `no` |
| fp_text unlocked | `(unlocked yes)` 支持 | ❌ 不存在 |
| 图形元素 net | `gr_*` 支持 `(net ...)` 分配网络 | ❌ 不支持 |
| 图形元素 locked | `gr_*` 支持 `(locked yes)` | ❌ 不支持 |

---

## PCB 降级转换规则

### K9 → K8 规则（P1-P9, P21-P23）

| 规则 | 说明 |
|------|------|
| P1 | 文件头降级: `version 20241229 → 20240108`，`generator_version "9.0" → "8.0"` |
| P2 | 层 ID 重映射: K9 新编号 → K8 传统编号（按层名匹配） |
| P3 | `layerselection` 位掩码: 128 位 4 段 → 紧凑 2 段格式 |
| P4 | 移除 `(tenting ...)`，添加 `(viasonmask no)` 到 pcbplotparams |
| P5 | 移除 `(embedded_fonts ...)` — 顶层和所有 footprint 内部 |
| P6 | 移除 K9 新增 pcbplotparams 参数 |
| P7 | 恢复 K8 的 `plotreference`、`plotvalue`、`plotfptext` 参数 |
| P8 | 移除 K9 专有顶层元素（`embedded_files`、`component_class`） |
| P9 | 移除 Datasheet/Description 属性字体中的 `thickness` |
| P21 | 移除 dimension style 中的 `(arrow_direction ...)`，`(keep_text_aligned yes)` → 裸原子 |
| P22 | 移除 zone 中的 `(placement ...)`（多通道自动放置区域，K9 特有功能） |
| P23 | pad teardrops 中 `(curved_edges ...)` → `(curve_points ...)`（K9 重命名） |

### K8 → K7 规则（P10-P26）

| 规则 | 说明 |
|------|------|
| P10 | 文件头降级，移除 `generator_version`，`generator` 去引号 |
| P11 | `(uuid "xxx")` → `(tstamp xxx)` 全局递归转换 |
| P12 | `(property "Reference" ...)` → `(fp_text reference ...)` |
| P13 | `(property "Value" ...)` → `(fp_text value ...)` |
| P14 | 移除所有 K7 不支持的 footprint property（`Footprint`/`Datasheet`/`Description` 及自定义属性如 `Champ4`） |
| P15 | `(sheetname)`/`(sheetfile)` → `(property ...)` 格式 |
| P16 | `(locked yes)` → 裸 `locked` 原子 |
| P17 | 移除 `(legacy_teardrops)` |
| P18 | 移除 `(allow_soldermask_bridges_in_footprints)` |
| P19 | pcbplotparams 布尔值 `yes/no` → `true/false` |
| P20 | 移除 K8 新增 pcbplotparams（`pdf_front/back_fp_property_popups`、`plotfptext`） |
| P21 | pad 属性兼容：`(remove_unused_layers yes)` → 裸标志 / `no` 时移除；`(keep_end_layers)` 同理；移除 `(pintype)`、`(pinfunction)` |
| P21b | property/effects/font/model 中 `(hide yes)` → 裸 `hide`，`(bold yes)` → 裸 `bold`，`(italic yes)` → 裸 `italic` |
| P22 | 图形元素 `(fill no)` → `(fill none)`（K7 只接受 `yes`/`none`/`solid`，不接受 `no`） |
| P23 | 移除 `fp_text` 中的 `(unlocked yes)`（K7 不支持此属性） |
| P24 | 移除顶层图形元素（`gr_line`/`gr_circle`/`gr_arc`/`gr_rect`/`gr_poly`/`gr_text`）中的 `(net ...)`（K7 不支持） |
| P25 | 移除顶层图形元素（`gr_text`/`gr_line` 等）中的 `(locked yes)`（K7 不支持） |
| P26 | `group` 节点：`(uuid/tstamp ...)` → `(id ...)`，移除 `(locked yes)`（K7 group 用 `id`） |

---

## 第四部分：封装 (.kicad_mod) 格式差异

通过对比 `asset/kicad9/kicad-footprints-9.0.7/`、`asset/kicad8/kicad-footprints-v8/`、`asset/kicad7/kicad-footprints-v7/` 中的 `C_0402_1005Metric` 和 `USB_C_Receptacle_GCT_USB4085` 等封装文件，总结出以下三个版本之间的差异。

> [!NOTE]
> 封装文件（`.kicad_mod`）本质上是 PCB 文件中 `(footprint ...)` 节点的独立文件形式。许多差异与 PCB 格式中的 footprint 差异相同，但封装文件还有一些独有的差异（如 `stroke` → `width` 格式、通配符层名引号等）。

### 三版本核心差异对照表

| 差异点 | KiCad 9 | KiCad 8 | KiCad 7 |
|--------|---------|---------|--------|
| version | `20241229` | `20240108` | `20211014` |
| generator | `"pcbnew"` / `"kicad-footprint-generator"` | `"pcbnew"` | `pcbnew`（无引号） |
| generator_version | `"9.0"`（可能不存在） | `"8.0"` | ❌ 不存在 |
| `embedded_fonts` | `(embedded_fonts no)` | ❌ 不存在 | ❌ 不存在 |
| 参考标识 | `(property "Reference" ...)` | `(property "Reference" ...)` | `(fp_text reference ...)` |
| 值 | `(property "Value" ...)` | `(property "Value" ...)` | `(fp_text value ...)` |
| 额外属性 | `Datasheet`、`Description` | `Footprint`、`Datasheet`、`Description` | ❌ 不存在 |
| ID 标识符 | `(uuid "xxx")` | `(uuid "xxx")` | `(tstamp xxx)`（无引号原子） |
| 图形线宽 | `(stroke (width W) (type T))` | `(stroke (width W) (type T))` | `(width W)` 直接子节点 |
| 图形填充 | `(fill no)` | `(fill no)` | `(fill none)` |
| pad 层名 | `(layers "*.Cu" "*.Mask")` | `(layers "*.Cu" "*.Mask")` | `(layers *.Cu *.Mask)`（无引号） |
| pad 标志 | `(remove_unused_layers no)` | `(remove_unused_layers no)` | 裸 `(remove_unused_layers)` 或不存在 |
| hide/bold/italic | `(hide yes)` | `(hide yes)` | 裸 `hide` 原子 |

### 封装差异 1: 文件头

```diff
;; KiCad 9:
 (footprint "C_0402_1005Metric"
     (version 20241229)
     (generator "kicad-footprint-generator")
+    (embedded_fonts no)          ← K8 不支持

;; KiCad 8:
 (footprint "C_0402_1005Metric"
     (version 20240108)
     (generator "pcbnew")
     (generator_version "8.0")   ← K7 不存在

;; KiCad 7:
-(footprint "C_0402_1005Metric" (version 20211014) (generator pcbnew)
+;; 注意: 无 generator_version，generator 无引号
```

### 封装差异 2: Reference/Value 表示方式

```diff
;; KiCad 8/9:
 (property "Reference" "REF**"
     (at 0 -1.16 0)
     (layer "F.SilkS")
     (uuid "3f001d39-...")
     (effects ...))

;; KiCad 7:
-(fp_text reference "REF**" (at 0 -1.16) (layer "F.SilkS")
+    (effects ...)
+    (tstamp 3f001d39-...))
```

### 封装差异 3: 图形元素线宽格式 ⚠️ 关键

```diff
;; KiCad 8/9:
 (fp_line
     (start -0.107836 -0.36)
     (end 0.107836 -0.36)
-    (stroke
-        (width 0.12)
-        (type solid)
-    )
     (layer "F.SilkS")
     (uuid "5cd5b77f-..."))

;; KiCad 7:
+(fp_line (start ...) (end ...) (layer "F.SilkS") (width 0.12) (tstamp ...))
```

### 封装差异 4: pad 通配符层名引号

```diff
;; KiCad 8/9:
 (pad "A1" thru_hole circle
-    (layers "*.Cu" "*.Mask"))

;; KiCad 7:
+(pad "A1" thru_hole circle ... (layers *.Cu *.Mask) ...)
```

---

## 封装降级转换规则

### K9 → K8 规则（F1-F4）

| 规则 | 说明 |
|------|------|
| F1 | 文件头降级: `version 20241229 → 20240108`，设置 `generator_version "8.0"` |
| F2 | 移除 `(embedded_fonts ...)` |
| F3 | 移除 Datasheet/Description 属性字体中的 `thickness` |
| F4 | pad teardrops 中 `(curved_edges yes/no)` → `(curve_points N)`（布尔 → 数值，yes→5, no→0） |

### K8 → K7 规则（F10-F18）

| 规则 | 说明 |
|------|------|
| F10 | 文件头降级: `version → 20211014`，移除 `generator_version`，`generator` 去引号 |
| F11 | `(uuid "xxx")` → `(tstamp xxx)` 全局递归转换（值从 string 变 atom） |
| F12 | `(property "Reference" ...)` → `(fp_text reference ...)`；`(property "Value" ...)` → `(fp_text value ...)` |
| F13 | 移除 `(property "Footprint"/"Datasheet"/"Description" ...)` 及自定义属性 |
| F14 | `(stroke (width W) (type T))` → `(width W)` — 图形元素中提取线宽，移除 stroke 包装 |
| F15 | `(fill no)` → `(fill none)` — K7 只接受 `yes`/`none`/`solid` |
| F16 | pad 兼容: `(remove_unused_layers yes)` → 裸标志 / `no` 时移除；移除 `(pintype)`/`(pinfunction)`/`(teardrops)` |
| F17 | `(hide/bold/italic yes)` → 裸原子；移除 `(unlocked yes)` |
| F18 | 通配符层名去引号: `"*.Cu"` → `*.Cu`（string → atom） |
