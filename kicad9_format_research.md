# KiCad 多版本文件格式差异研究报告（修订版）

> [!NOTE]
> 本报告基于 KiCad 源码 `sch_file_versions.h` 和实际样例文件对比分析。
> 涵盖原理图文件（`.kicad_sch`）和符号库文件（`.kicad_sym`）两种格式。

## 背景

KiCad 使用 S-expression 格式保存原理图文件（`.kicad_sch`）和符号库文件（`.kicad_sym`）。文件头的 `version` 字段用 `YYYYMMDD` 日期格式标识。
**KiCad 只保证向后兼容（新版可打开旧版），不支持向前兼容（旧版无法打开新版）。**
目前市面上**没有**任何现成的 KiCad 9 → KiCad 8 降级工具。

---

## 第一部分：原理图 (.kicad_sch) 格式差异

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
输入: KiCad 9 .kicad_sch / .kicad_sym 文件
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
   │   文件类型检测                     │
   │   kicad_sch → 原理图规则          │
   │   kicad_symbol_lib → 符号库规则   │
   └────────┬─────────────────────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
 ┌─────────┐  ┌──────────┐
 │ 原理图   │  │ 符号库    │
 │ R1-R8   │  │ S1-S4   │  ← K9→K8 转换
 │ R10-R15 │  │ S10-S14 │  ← K8→K7 转换
 └────┬────┘  └────┬────┘
      └──────┬─────┘
             ▼
   ┌──────────────────┐
   │ S-expression 序列化│  ← 保持 KiCad 缩进风格
   │   (Pretty Print)  │
   └────────┬─────────┘
            │
            ▼
   输出: KiCad 8 或 KiCad 7 兼容文件
```

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
> - **有损转换**: 表格、规则区域、嵌入文件等 K9 特有功能在降级时**丢失**
> - ~~**符号库文件**: `.kicad_sym` 符号库文件也有版本差异，需要单独处理~~ ✅ 已实现
> - **多 Sheet 项目**: 每个 `.kicad_sch` 文件都需要单独转换
> - **项目文件**: `.kicad_pro` 项目文件也需要版本降级处理
> - **PCB 文件**: `.kicad_pcb` 文件也有类似的版本问题，但属于不同的转换任务
> - **行长度限制**: KiCad 8 对单行长度有限制，嵌入图片的 base64 数据需逐行输出，否则会报 `maximum line length exceeded`

> [!IMPORTANT]
> 该工具的目标是"尽力降级"——保留所有核心电路信息（连接性、元器件、值、位置），安全移除或转换 KiCad 9 新增的非关键格式特性。

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
