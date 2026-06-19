# KiCad Multi-Version Converter

一个基于浏览器的工具，用于将 KiCad 原理图文件（`.kicad_sch`）、符号库文件（`.kicad_sym`）、PCB 文件（`.kicad_pcb`）和封装文件（`.kicad_mod`）进行版本降级转换，支持以下转换路径：

- **KiCad 10 → KiCad 9**（原理图/符号库/PCB/封装）
- **KiCad 9 → KiCad 8**
- **KiCad 8 → KiCad 7**
- **KiCad 7 → KiCad 6**
- **KiCad 6 → KiCad 5** — PCB/封装保持 S-表达式格式（`.kicad_pcb` / `.kicad_mod`，`(footprint)` → `(module)`）；原理图和符号库跨越 KiCad 5/6 文件家族边界，写出为**传统文本格式**：`.kicad_sch` → `.sch`（+ 一个 `-cache.lib`），`.kicad_sym` → `.lib`（+ `.dcm`）
- **链式转换**，例如 KiCad 10 → KiCad 5（10→9→8→7→6→5）、KiCad 9 → KiCad 7、KiCad 8 → KiCad 6 等

## 功能特性

- **浏览器端转换**：纯前端实现，无需服务器，文件不会上传到任何地方
- **四种文件类型**：支持 `.kicad_sch`（原理图）、`.kicad_sym`（符号库）、`.kicad_pcb`（PCB）和 `.kicad_mod`（封装）
- **批量处理**：支持同时上传多个文件，一键转换并打包下载
- **自动检测**：自动检测文件类型和版本（支持 KiCad 6/7/8/9/10），使用对应的转换规则
- **传统 KiCad 5 输出**：KiCad 6 原理图/符号库会输出为传统 Eeschema `.sch` 和 `.lib`/`.dcm` 格式；单个输入可能产生多个文件（例如 `.sch` + `-cache.lib`）
- **链式降级**：例如 KiCad 10 → KiCad 5 会自动执行五步转换（10→9→8→7→6→5）
- **转换日志**：显示详细的转换过程日志和警告信息

## 转换规则

### 原理图 (.kicad_sch) — KiCad 10 → KiCad 9（N1-N10）

| 规则 | 说明 |
|------|------|
| N1 | 文件头版本号降级（`version` → `20250114`，`generator_version` → `9.0`） |
| N2 | 移除 lib_symbol 中 K10 新增属性（`in_pos_files`、`duplicate_pin_numbers_are_jumpers`） |
| N3 | 移除 property 中的 `show_name` 和 `do_not_autoplace` 属性 |
| N4 | property 层级的 `(hide yes)` 移入 `effects` 节点内部（K10 提升到 property 层级，K9 在 effects 内） |
| N5 | 移除 symbol 实例中的 `(body_style ...)` 属性 |
| N6 | `(power global)` → `(power)`（K10 新增 `global` 参数，K9 使用裸 `power`） |
| N7 | 移除 lib_symbol 中的 `(body_styles ...)` 节点 |
| N8 | lib_symbol 中空 pin 名 `(name "")` → `(name "~")`（K10 用空字符串，K9 用波浪号） |
| N9 | 移除 `(path ...)` 中的 `(variant ...)`（K10 变体功能，K9 不支持） |
| N10 | 移除顶层 `(group ...)`（K10 原理图分组功能，K9 不支持） |

> ⚠️ **层次图纸提示**：含有子图纸引用的项目需要将所有 `.kicad_sch` 文件一同上传转换，否则 KiCad 打开时子图纸会因版本过高而报错。

### 原理图 (.kicad_sch) — KiCad 9 → KiCad 8（R1-R8）

| 规则 | 说明 |
|------|------|
| R1 | 文件头版本号降级（`version` → `20231120`，`generator_version` → `8.0`） |
| R2 | `pin_names` / `pin_numbers` 中 `(hide yes)` → 裸 `hide` |
| R3 | `pin` 定义中 `(hide yes)` → 裸 `hide` |
| R4 | 移除 `embedded_fonts` 节点 |
| R5 | 调整 sheet pin 中 `uuid` 的位置（移到 `effects` 之后） |
| R6 | 移除 sheet 的 KiCad 9 新属性（`exclude_from_sim`、`in_bom`、`on_board`、`dnp`） |
| R7 | 移除 KiCad 9 专有元素（`table`、`rule_area`、`embedded_files`） |
| R8 | 移除 `text_box` 中的 `margins` 属性及 `text`/`text_box` 中的 `exclude_from_sim` |

### 原理图 (.kicad_sch) — KiCad 8 → KiCad 7（R10-R15）

| 规则 | 说明 |
|------|------|
| R10 | 文件头降级（`version` → `20230121`，移除 `generator_version`，`generator` 去引号） |
| R11 | 递归移除所有节点中的 `exclude_from_sim` 属性 |
| R12 | 移除 `lib_symbols` 符号定义中的 `Description` 属性 |
| R13 | `effects`/`font` 中 `(hide yes)` → 裸 `hide`，`(bold yes)` → 裸 `bold`，`(italic yes)` → 裸 `italic` |
| R14 | `(fields_autoplaced yes)` → `(fields_autoplaced)`（移除值参数）；移除 `(dnp)` 节点 |
| R15 | 嵌入图片非 PNG 格式（如 BMP）自动转换为 PNG（使用 Canvas API，KiCad 7 仅支持 PNG） |

### 原理图 (.kicad_sch) — KiCad 7 → KiCad 6（R20-R30）

| 规则 | 说明 |
|------|------|
| R20 | 文件头降级（`version` → `20211123`，移除 `generator_version`） |
| R21 | 移除 KiCad 7 独有功能 `text_box`/`textbox`、`simulation_model`/`sim_model`、`netclass_flag`/`directive_label`，以及根层级的图形绘制图元 `(rectangle)`、`(circle)`、`(polyline)`、`(arc)`、`(bezier)`（有损） |
| R21b | 移除所有 `(font ...)` 节点中的 `(color ...)`（KiCad 6 字体不支持自定义颜色） |
| R22 | 递归移除 `exclude_from_sim`（KiCad 6 不支持仿真排除） |
| R23 | 移除放置符号中的 `(dnp ...)`；移除原理图页（sheet）中的 `exclude_from_sim`/`in_bom`/`on_board`/`dnp` |
| R24 | 移除 lib_symbol 引脚中的 `(hide ...)` 和 `(alternate ...)` 子列表 |
| R25 | 移除放置符号的引脚 UUID 块 `(pin "N" (uuid ...))`（KiCad 7 独有，KiCad 6 实例中不使用） |
| R26 | 为符号/原理图页属性添加遗留的 `(id N)`（KiCad 7 原理图属性省略了 id，而 KiCad 6 强制要求）。标准名称使用固定 id（Reference 为 0，Value 为 1 等）；自定义字段使用 id ≥ 5 |
| R27 | 规范化原理图页属性名称和 id：`Sheetname` → `"Sheet name"` (id 0)，`Sheetfile` → `"Sheet file"` (id 1) |
| R28 | 从每个 KiCad 7 对象的 `(instances (project ...))` 块中，在根层级重新构建 KiCad 6 全局的 `(symbol_instances ...)` 和 `(sheet_instances ...)` 表 |
| R29 | 移除现已冗余的每个对象内部的 `(instances ...)` 块 |
| R30 | 降级 `(fill (type color) (color ...))` → `(fill (type background))`（普通的 `(fill (color ...))` 保持不变） |

> ⚠️ **KiCad 6 验证提示**：KiCad 6 实例表是根据 KiCad 7 层次路径启发式重建的。位号（Reference designators）仍会保留在每个符号的 `Reference` 属性中，但对于深层嵌套的层次化项目，建议在 KiCad 6 中重新打开以确认转换结果。

### 原理图 (.kicad_sch → .sch) — KiCad 6 → KiCad 5（跨文件家族）

KiCad 5 原理图使用传统 Eeschema **文本**格式而非 S-表达式，因此这是一次跨家族重写，而不是逐节点编辑。转换器会输出：

- `<name>.sch` — `EESchema Schematic File Version 4` 文件头 + `$Descr` 标题栏，然后是 `$Comp` 元件（`L`/`U`/`P`/`F0…Fn` + 方向矩阵）、`Wire Wire/Bus Line`、`Entry Wire Line`、`Connection`/`NoConn`、`Text Label`/`GLabel`/`HLabel`/`Notes`，以及 `$Sheet` 块（子图纸的 `Sheet file` 引用会从 `.kicad_sch` 改写为 `.sch`）。
- `<name>-cache.lib` — 从原理图内嵌的 `(lib_symbols ...)` 生成的传统符号库，使符号在没有原始库的情况下也能在 KiCad 5 中显示。

**符号解析**：缓存符号命名为 `nickname_item`（例如 `video_schlib_S5933_PQ160`）——这正是 KiCad 5 回退到项目缓存时构造的键（`SCH_COMPONENT::Resolve` 会格式化 lib id 并把 `:` 替换为 `_`），因此元件 `L video_schlib:S5933_PQ160 U11` 能自动解析。对于**层次化项目**，请将其所有 `.kicad_sch` 文件一同上传：转换器会找到根图纸，并把每个图纸的符号合并到一个共享的 `<root>-cache.lib` 中（KiCad 5 对整个层次结构只加载一个项目缓存）。

坐标按 mm → mil 转换（无坐标轴翻转）。元件方向/镜像矩阵、符号圆弧几何以及**标签方向**均已对照 KiCad 自身源码与传统示例输出验证（旋转、镜像、镜像+旋转组合、引脚/圆弧角度均一致）。这里处理了一个标签方向的特殊情况：KiCad 存储**全局/层次**标签方向时，相对**局部**标签把 `0`↔`2` 互换（见 `sch_legacy_plugin` 的 `loadText`），因此有方向的端口映射为 `{角度 0→2, 90→1, 180→0, 270→3}`，而局部标签/文本使用 `角度/90`——否则端口旗标会指向错误方向。**有损 / 限制**：每个文件一个图纸（位号取自每个符号的 `Reference` 属性；不合成跨图纸的实例 `AR` 表，深层层次结构可能需要重新标注）；层次图纸的**图纸引脚**（sheet port）使用尽力而为的方位映射。使用前请验证。

### 符号库 (.kicad_sym) — KiCad 10 → KiCad 9（NS1-NS8）

| 规则 | 说明 |
|------|------|
| NS1 | 文件头版本号降级（`version` → `20241209`，`generator_version` → `9.0`） |
| NS2 | 移除 K10 新增属性（`in_pos_files`、`duplicate_pin_numbers_are_jumpers`） |
| NS3 | 移除 property 中的 `show_name` 和 `do_not_autoplace` 属性 |
| NS4 | property 层级的 `(hide yes)` 移入 `effects` 节点内部 |
| NS6 | `(power global)` → `(power)`（K10 新增 `global` 参数，K9 使用裸 `power`） |
| NS7 | 移除 symbol 中的 `(body_styles ...)` 节点 |
| NS8 | 空 pin 名 `(name "")` → `(name "~")`（K10 用空字符串，K9 用波浪号） |

### 符号库 (.kicad_sym) — KiCad 9 → KiCad 8（S1-S4）

| 规则 | 说明 |
|------|------|
| S1 | 文件头版本号降级（`version` → `20231120`，`generator_version` → `8.0`） |
| S2 | `pin_names` / `pin_numbers` 中 `(hide yes)` → 裸 `hide` |
| S3 | `pin` 定义中 `(hide yes)` → 裸 `hide` |
| S4 | 移除每个符号定义末尾的 `(embedded_fonts no)` |

### 符号库 (.kicad_sym) — KiCad 8 → KiCad 7（S10-S14）

| 规则 | 说明 |
|------|------|
| S10 | 文件头降级（`version` → `20220914`，移除 `generator_version`，`generator` 去引号） |
| S11 | 递归移除所有符号中的 `exclude_from_sim` 属性 |
| S12 | `(property "Description" ...)` → `(property "ki_description" ...)`（属性名重命名） |
| S13 | `effects`/`font` 中 `(hide yes)` → 裸 `hide`，`(bold yes)` → 裸 `bold`，`(italic yes)` → 裸 `italic` |
| S14 | 移除 `(pin_numbers hide)` 节点；`pin_names` 中移除 `hide` 标记 |

### 符号库 (.kicad_sym) — KiCad 7 → KiCad 6（S20-S23）

| 规则 | 说明 |
|------|------|
| S20 | 文件头降级（`version` → `20211014`，移除 `generator_version`） |
| S21 | 移除符号文本框 (`text_box`/`textbox`) — KiCad 7 特性（有损） |
| S22 | 移除引脚上的 `(hide ...)` 和 `(alternate ...)` 子列表 |
| S23 | 降级 `(fill (type color) (color ...))` → `(fill (type background))` |

### 符号库 (.kicad_sym → .lib + .dcm) — KiCad 6 → KiCad 5（跨文件家族）

KiCad 5 符号库使用传统的 `.lib`（2.4）+ `.dcm`（2.0）**文本**格式。转换器会输出：

- `<name>.lib` — `EESchema-LIBRARY Version 2.4`，每个符号一个 `DEF … ENDDEF`：`F0–F3` 标准字段 + 自定义 `F4+`、派生（`extends`）符号的 `ALIAS` 行、来自 `ki_fp_filters` 的 `$FPLIST`，以及一个 `DRAW` 段（`S` 矩形、`C` 圆、`P` 折线、`A` 圆弧、`T` 文本、`X` 引脚）。
- `<name>.dcm` — 来自 `ki_description`/`ki_keywords`/`Datasheet` 的 `$CMP`/`D`/`K`/`F` 记录（仅在存在时输出）。

坐标按 mm → mil 转换（两种格式中符号均为 Y 轴向上；不翻转）。引脚电气类型/形状、隐藏标志、电源符号（`P` 标志）、多单元（`_unit_style`）布局，以及 `extends` → `ALIAS` 均已映射。**有损 / 限制**：带有自身图形的派生符号只保留基础符号的图形（传统 `ALIAS` 的限制）。

### PCB (.kicad_pcb) — KiCad 10 → KiCad 9（NP1-NP11）

| 规则 | 说明 |
|------|------|
| NP1 | 文件头版本号降级（`version` → `20241229`，`generator_version` → `9.0`） |
| NP2 | `tenting` 嵌套格式转紧凑格式：`(tenting (front yes) (back yes))` → `(tenting front back)` |
| NP3 | 移除 setup 中的 K10 过孔处理属性（`covering`、`plugging`、`capping`、`filling`） |
| NP4 | 恢复 K9 的 pcbplotparams 参数（`hpglpennumber`、`hpglpenspeed`、`hpglpendiameter`、`plotinvisibletext`）；修复浮点格式 |
| NP5 | 收集所有网络名称（从 `segment`/`arc`/`via`/`zone`/`pad`/`gr_rect`/`gr_arc`/`gr_line`/`gr_poly`/`gr_circle`），分配 ID，在 setup 之后插入 `(net ID "name")` 声明块 |
| NP6 | 转换网络引用：名称→ID。`segment`/`arc`/`via`/`gr_rect`/`gr_arc`/`gr_line`/`gr_poly`/`gr_circle` 中 `(net "name")` → `(net ID)`；`pad` 中 `(net "name")` → `(net ID "name")`；`zone` 中 `(net "name")` → `(net ID)` + 添加 `(net_name "name")` |
| NP7 | 移除 via 中的 `capping`/`covering`/`plugging`/`filling` 属性 |
| NP8 | zone fill 修复：移除 `(island_removal_mode ...)`，移除 `filled_polygon` 中的 `(island ...)`，添加 `(filled_areas_thickness no)` |
| NP9 | 移除 footprint 级别的 K10 专有属性（`units`、`duplicate_pad_numbers_are_jumpers`、`point`、`component_classes`） |
| NP10 | 恢复 footprint 中 Datasheet/Description 属性的 `(unlocked yes)` 和字体 `(thickness 0.15)` |
| NP11 | 移除 `gr_rect`/`fp_rect` 中的 `(radius ...)`（K10 圆角矩形功能，K9 不支持） |

### PCB (.kicad_pcb) — KiCad 9 → KiCad 8（P1-P9, P21-P23, P27）

| 规则 | 说明 |
|------|------|
| P1 | 文件头版本号降级（`version` → `20240108`，`generator_version` → `8.0`） |
| P2 | 层 ID 映射：KiCad 9 新编号方案 → KiCad 8 传统编号（0-49） |
| P3 | `layerselection` 位掩码格式：128 位 → 紧凑格式 |
| P4 | 移除 `(tenting ...)`，在 `pcbplotparams` 中添加 `(viasonmask no)` |
| P5 | 移除 `(embedded_fonts ...)` — 顶层和 footprint 内部 |
| P6 | 移除 K9 新增 pcbplotparams 参数（`pdf_metadata`、`plotpadnumbers`、`hidednponfab` 等） |
| P7 | 恢复 K8 的 pcbplotparams 参数（`plotreference`、`plotvalue`、`plotfptext`） |
| P8 | 移除 K9 专有顶层元素（`embedded_files`、`component_class`） |
| P9 | 移除 Datasheet/Description 属性字体中的 `thickness` |
| P21 | dimension style 中移除 `(arrow_direction ...)`，`(keep_text_aligned yes)` → 裸原子；dimension format 中 `(suppress_zeroes yes)` → 裸原子 |
| P22 | 移除 zone 中的 `(placement ...)`（KiCad 9 多通道自动放置区域功能，K8 不支持） |
| P23 | pad teardrops 中 `(curved_edges ...)` → `(curve_points ...)`（K9 重命名，K8 不认识） |
| P27 | `(solder_paste_margin_ratio ...)` → `(solder_paste_ratio ...)`（K9 重命名，K8 使用旧名称） |

### PCB (.kicad_pcb) — KiCad 8 → KiCad 7（P10-P28）

| 规则 | 说明 |
|------|------|
| P10 | 文件头降级（`version` → `20221018`，移除 `generator_version`，`generator` 去引号） |
| P11 | `(uuid "xxx")` → `(tstamp xxx)`（全局递归） |
| P12 | `(property "Reference" ...)` → `(fp_text reference ...)` |
| P13 | `(property "Value" ...)` → `(fp_text value ...)` |
| P14 | 移除所有 K7 不支持的 footprint property（`Footprint`/`Datasheet`/`Description` 及自定义属性如 `Champ4`） |
| P15 | `(sheetname ...)`/`(sheetfile ...)` → `(property "Sheetname"/"Sheetfile" ...)` |
| P16 | `(locked yes)` 子节点 → footprint 行上的裸 `locked` 原子 |
| P17 | 移除 `general` 中的 `(legacy_teardrops ...)` |
| P18 | 移除 `setup` 中的 `(allow_soldermask_bridges_in_footprints ...)` |
| P19 | `pcbplotparams` 中布尔值 `yes/no` → `true/false` |
| P20 | 移除 K8 新增 pcbplotparams（`pdf_front/back_fp_property_popups`、`plotfptext`） |
| P21 | pad/via 属性兼容：`(remove_unused_layers yes)` → 裸标志 / `no` 时移除；`(keep_end_layers ...)` 同理；移除 `(pintype ...)`、`(pinfunction ...)`、`(teardrops ...)`、`(free yes)`、`(zone_layer_connections ...)` |
| P21b | property/effects/font/model 中 `(hide yes)` → 裸 `hide`，`(bold yes)` → 裸 `bold`，`(italic yes)` → 裸 `italic` |
| P22 | 图形元素填充属性 `(fill no)` → `(fill none)`（KiCad 7 只接受 `yes`/`none`/`solid`，不接受 `no`） |
| P23 | 移除 `fp_text` 中的 `(unlocked yes)`（KiCad 7 不支持此属性） |
| P24 | 移除顶层图形元素（`gr_line`/`gr_circle`/`gr_arc` 等）中的 `(net ...)`（KiCad 7 不支持图形元素分配网络） |
| P25 | 移除顶层图形元素（`gr_text`/`gr_line` 等）中的 `(locked yes)`（KiCad 7 不支持） |
| P26 | `group` 节点：`(uuid ...)` → `(id ...)`，移除 `(locked yes)`（KiCad 7 的 group 用 `id` 不用 `tstamp`） |
| P27 | 移除 footprint `(attr ...)` 中的 K8 专有标志（`dnp`、`allow_missing_courtyard`） |
| P28 | 移除顶层 `(generated ...)` 元素（调谐图案等 KiCad 8 特有功能，K7 不支持） |

### PCB (.kicad_pcb) — KiCad 7 → KiCad 6（P40-P49）

| 规则 | 说明 |
|------|------|
| P40 | 文件头降级（`version` → `20211014`，移除 `generator_version`，`generator` 去引号） |
| P41 | 移除 KiCad 7 独有特性：`gr_text_box`/`fp_text_box`/`text_box`、`image`、`net_tie`/`net_ties`/`net_tie_pad_groups`（有损） |
| P41b | 将封装（footprint）层级的 `(dimension ...)` 节点移动到根 PCB 层级（KiCad 6 不支持封装内部包含尺寸标注） |
| P42 | 在所有 `gr_*`/`fp_*` 图形形状中，将 `(stroke (width W) (type T))` → `(width W)`（KiCad 6 使用扁平宽度属性） |
| P43 | `pcbplotparams` 中的布尔值 `yes`/`no` → `true`/`false` |
| P44 | 图形形状中的 `(fill no)` → `(fill none)` |
| P45 | 移除 `gr_text`/`fp_text` 中的 `(render_cache ...)` |
| P46 | 过孔（Via）层连接属性：`(remove_unused_layers yes)`/`(keep_end_layers yes)` → 裸标志（为 `no` 时移除）；移除 `(zone_layer_connections ...)` 和 `(free ...)` |
| P47 | 移除焊盘/区域中的 `(thermal_bridge_angle ...)`；移除区域中的 `(attr ...)` |
| P48 | 尺寸标注降级：`(type radial)` → `(type leader)` 并移除径向独有的 `(leader_length ...)` — **径向尺寸（radial dimension）是 KiCad 7 特性，KiCad 6 仅支持 `aligned`/`orthogonal`/`leader`/`center`，如果不降级会使整块板子加载失败（打开时崩溃）。** 此外，移除尺寸标注样式中的 `(arrow_direction ...)` |
| P49 | 移除 3D `model` 节点中的 `(hide ...)` |

> ⚠️ **径向尺寸提示（有损）**：KiCad 6 没有径向尺寸类型。P48 将 `(type radial)` 重写为最接近的模拟类型：`leader`（引线 + 文本），保留文本/格式（包含 `override_value`）并丢弃径向独有的 `leader_length`。标注虽能保留，但其语义由真实的径向/直径测量退化为普通的引线标注。每个被转换的径向尺寸都会触发一条警告。（这些径向尺寸在 KiCad 7 中常位于封装内部；P41b 会先将其提升至板子根层级，再由 P48 完成降级。）

### PCB (.kicad_pcb) — KiCad 6 → KiCad 5（P50-P64）

| 规则 | 说明 |
|------|------|
| P50 | 文件头降级：`version` → `20171130`；把 K6 的 `(generator pcbnew)` 改写为 KiCad 5 的 `(host pcbnew "(5.1.5)")`（K5 板解析器要求 `(host 应用 版本)` 这种 3-token 形式，会拒绝 `(generator …)`）；`(paper …)` → `(page …)`（K5 只认 `page`） |
| P51 | 层定义块：去掉 K6 的第 3 个描述字段、层名去引号、映射重命名的用户层（`User.Drawings` → `Dwgs.User`），并**移除 KiCad 5 没有的用户层** —— `User.1`–`User.9`（层 ID 50-58）；K5 的层集固定为 ID 0-49，否则会报 *"Layer … is not in fixed layer hash"* |
| P51b | 把指向已删除层的对象 `(layer …)` 引用重映射为 `Dwgs.User`，并**保留焊盘的层集通配符** `*.Cu`/`*.Mask`/`F&B.Cu` |
| P52 | 移除 `setup` 中的 `(stackup ...)`（板层叠是 KiCad 6+ 特性） |
| P53 | `(footprint ...)` → `(module ...)`：**仅在安全时**给名称去引号（含空格/括号的名称保留引号——未加引号的 `lib:FOO(DC-10A)` 会让 K5 把 `(DC-10A)` 当作子节点而出错），把 `(attr ...)` 映射为裸 `smd`/`virtual`（否则丢弃），丢弃 `property`/`group`/`net_tie_pad_groups`，把 `(path ...)` 的 UUID 截断为 8 位十六进制 |
| P54 | 图形圆弧（`gr_arc`/`fp_arc`）三点式 `(start)(mid)(end)` → 传统的 `(start=圆心)(end)(angle)` |
| P55 | `roundrect`/`custom` 焊盘 → `rect`；丢弃 `roundrect_rratio`/`chamfer`/`options`/`primitives`、`pinfunction`/`pintype`、`zone_layer_connections`/`remove_unused_layers` |
| P56 | 区域（Zone）：移除 `filled_areas_thickness`/`name`/`attr`；丢弃 keepout 区域；把多层区域拆分为每层一个区域；清理 `filled_polygon`（`layer`/`island`） |
| P57 | `gr_rect`/`fp_rect` → 四条线段（KiCad 5 没有矩形图元） |
| P58 | 弧形布线 `(arc ...)` → 直线 `(segment ...)` 近似（有损） |
| P59 | 移除 KiCad 6 专有的过孔属性（`free`、`remove_unused_layers`、`zone_layer_connections`） |
| P60 | 移除所有 `(tstamp ...)`/`(uuid ...)` 标识符（KiCad 5 会重新生成 8 位十六进制 stamp；基于网络的连接关系会保留） |
| P61 | 丢弃 K6 参数化的 `(dimension …)` 对象——K5 需要显式的 feature/arrow 几何；有损，并发出警告 |
| P62 | 3D 模型 `(offset (xyz …))` → `(at (xyz …))`（K5 的 `model` 节点用 `at`） |
| P63 | 从图形形状（`gr_poly`/`fp_poly`/`gr_circle`/…）中去掉 `(fill …)`——K5 的图形解析器会拒绝它；区域（zone）的 fill 保留 |
| P64 | 移除 `(group …)` 节点——KiCad 6 的对象分组（板级 + 嵌套）；K5 没有分组（*"Unknown token group"*）。被分组的对象会保留，只是不再成组 |

> K6 专有的 `pcbplotparams`（`dxf…`、`svg…`、`dashed_line_*`、`sketchpadsonfab`、`disableapertmacros` 等）保持原样——KiCad 5 的 `pcbplotparams` 子解析器会静默跳过不认识的 token（已对照 5.1 源码确认）。

> ✅ **已对照真实 KiCad 5 验证**：规则通过把重新生成的板子按节点类型与 KiCad 自带的 `5.1/demos/video/video.kicad_pcb` 逐一对比、并对照 5.1 的 `PCB_PARSER` 源码（严格的主解析器 vs 宽松的 `pcbplotparams`）推导/校验而来。真实板子随后又暴露并修复了一连串加载错误：`(host …)` 文件头、`(paper)`→`(page)`、`User.1`–`User.9` 层移除、图形 `(fill …)`、模型 `(offset)`→`(at)`、板级 `(group …)`、含括号的封装名加引号，以及 `rectToLines` 的线宽强转 bug（`[object Object]`）。最可靠的检查是**整板语法审计**（把每种顶层节点和每个 `(module …)` 子项对照 KiCad 5 接受的 token 集），从结构上而非逐个报错地排查。剩余有损项：被丢弃的参数化尺寸标注（P61）只是删除，不会重绘。

### 封装 (.kicad_mod) — KiCad 10 → KiCad 9（NF1-NF2）

| 规则 | 说明 |
|------|------|
| NF1 | 文件头版本号降级（`version` → `20241229`，`generator_version` → `9.0`） |
| NF2 | 移除 `(duplicate_pad_numbers_are_jumpers ...)`（K10 新增，K9 不存在） |

### 封装 (.kicad_mod) — KiCad 9 → KiCad 8（F1-F4）

| 规则 | 说明 |
|------|------|
| F1 | 文件头版本号降级（`version` → `20240108`，`generator_version` → `8.0`） |
| F2 | 移除 `(embedded_fonts ...)` |
| F3 | 移除 Datasheet/Description 属性字体中的 `thickness` |
| F4 | pad teardrops 中 `(curved_edges ...)` → `(curve_points ...)`（布尔值 → 数值） |

### 封装 (.kicad_mod) — KiCad 8 → KiCad 7（F10-F18）

| 规则 | 说明 |
|------|------|
| F10 | 文件头降级（`version` → `20221018`，移除 `generator_version`，`generator` 去引号） |
| F11 | `(uuid "xxx")` → `(tstamp xxx)`（全局递归） |
| F12 | `(property "Reference" ...)` → `(fp_text reference ...)`；`(property "Value" ...)` → `(fp_text value ...)` |
| F13 | 移除 `(property "Footprint")`、`(property "Datasheet")`、`(property "Description")` 及自定义属性 |
| F14 | `(stroke (width W) (type T))` → `(width W)`（图形元素中的线宽格式转换） |
| F15 | `(fill no)` → `(fill none)`（KiCad 7 不接受 `no` 值） |
| F16 | pad 属性兼容：`(remove_unused_layers yes)` → 裸标志 / `no` 时移除；移除 `(pintype)`、`(pinfunction)`、`(teardrops)` |
| F17 | `(hide yes)` → 裸 `hide`，`(bold yes)` → 裸 `bold`，`(italic yes)` → 裸 `italic`；移除 `(unlocked yes)` |
| F18 | pad 通配符层名去引号：`"*.Cu"` → `*.Cu`（KiCad 7 使用无引号原子） |

### 封装 (.kicad_mod) — KiCad 7 → KiCad 6（F20-F26）

| 规则 | 说明 |
|------|------|
| F20 | 文件头降级（`version` → `20211014`，移除 `generator_version`，`generator` 去引号） |
| F21 | 在 `fp_line`/`fp_rect`/`fp_circle`/`fp_arc`/`fp_poly`/`fp_curve` 中，将 `(stroke (width W) (type T))` → `(width W)` |
| F22 | 图形中的 `(fill no)` → `(fill none)` |
| F23 | 移除 `fp_text` 中的 `(render_cache ...)` |
| F24 | 移除 KiCad 7 独有的对象（`fp_text_box`、`image`、`net_tie_pad_groups`）— 有损 |
| F25 | 焊盘层连接属性：`(remove_unused_layers yes)`/`(keep_end_layers yes)` → 裸标志（为 `no` 时移除）；移除 `(zone_layer_connections ...)` 和 `(thermal_bridge_angle ...)` |
| F26 | 移除 3D `model` 节点中的 `(hide ...)` |

> **封装版本提示**：KiCad 7 的封装格式特征版本是 `20221018`，而 KiCad 6 是 `20211014`。（K8→K7 的封装规则 F10 现已更新为写入 `20221018`。）

### 封装 (.kicad_mod) — KiCad 6 → KiCad 5（F30-F38）

| 规则 | 说明 |
|------|------|
| F30 | `(footprint ...)` → `(module ...)`：丢弃 `version`/`generator`，**仅在安全时**给名称去引号（含空格/括号的名称保留引号），确保有 `(tedit ...)` 时间戳 |
| F31 | 把 `(attr ...)` 映射为裸 `smd`/`virtual`（through-hole + 子标志被丢弃） |
| F32 | `fp_arc` 三点式 `(start)(mid)(end)` → `(start=圆心)(end)(angle)` |
| F33 | `roundrect`/`custom` 焊盘 → `rect`；剥离 KiCad 6 专有的焊盘属性 |
| F34 | `fp_rect` → 四条 `fp_line` 线段 |
| F35 | 移除所有 `(tstamp ...)`/`(uuid ...)` |
| F36 | 丢弃 KiCad 6 专有子项（`property`/`group`/`net_tie_pad_groups`）；把 `(path ...)` 截断为 8 位十六进制 |
| F37 | 从图形形状中去掉 `(fill …)`——KiCad 5 的 `parseEDGE_MODULE` 会拒绝任何图形 fill（不仅是 `(fill no)`） |
| F38 | 3D 模型 `(offset (xyz …))` → `(at (xyz …))`（K5 的 `model` 节点用 `at`） |

> **说明**：随仓库附带的 KiCad 6 测试封装已经是传统 `(module)` 形式；此路径由 KiCad 7–10 封装的链式转换来覆盖。

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 技术栈

- **React** + **Vite** — 前端框架与构建工具
- **S-expression Parser** — 自定义的 KiCad S-表达式解析器（`src/lib/sexpr-parser.js`）
- **Converter** — 基于 AST 的版本转换引擎（`src/lib/converter.js` + `src/lib/sym-converter.js` + `src/lib/pcb-converter.js` + `src/lib/fp-converter.js`），支持 KiCad 10/9/8/7/6 链式降级
- **传统格式写入器** — KiCad 5 跨家族文本输出：`src/lib/sch-legacy-writer.js`（`.kicad_sch` → `.sch` + 缓存）和 `src/lib/sym-legacy-writer.js`（`.kicad_sym` → `.lib`/`.dcm`）

## 项目结构

```
converter/
├── src/
│   ├── lib/
│   │   ├── sexpr-parser.js       # S-expression 解析器和序列化器
│   │   ├── converter.js          # 统一转换入口 + 原理图转换规则
│   │   ├── sym-converter.js      # 符号库转换规则（S-表达式，K10→K6）
│   │   ├── pcb-converter.js      # PCB 转换规则（含 K6→K5）
│   │   ├── fp-converter.js       # 封装转换规则（含 K6→K5）
│   │   ├── sch-legacy-writer.js  # KiCad 6 → KiCad 5 传统 .sch 写入器（+ 缓存 .lib）
│   │   └── sym-legacy-writer.js  # KiCad 6 → KiCad 5 传统 .lib/.dcm 写入器
│   ├── App.jsx                   # 主应用组件（文件上传、转换、下载）
│   └── main.jsx                  # 入口文件
├── scripts/                     # KiCad 6 → KiCad 5 验证脚本（用 `node scripts/<file>` 运行）
│   ├── test-k6k5.mjs            # 端到端：四种文件类型转换、重新解析、版本号正确、值级检查
│   ├── test-k5-pcb-synth.mjs    # 自包含（不依赖素材）：一块合成 K6 板覆盖所有 K5 PCB 规则（P50-P64）
│   ├── check-k5-header.mjs      # 模拟 KiCad 5 PCB_PARSER::parseHeader（捕获 (host …) 问题）
│   ├── test-cache-match.mjs     # 每个原理图 L 的 lib_id 都能解析到缓存 DEF/ALIAS
│   ├── test-consolidate.mjs     # 层次化项目 → 一个共享的 <root>-cache.lib
│   ├── test-orient.mjs          # 元件矩阵 vs KiCad 精确的方向/镜像公式
│   ├── test-arc-roundtrip.mjs   # 符号圆弧角度 ↔ 端点自洽
│   └── test-label-orient.mjs    # 标签方向 vs KiCad 5 示例真值
├── index.html
├── package.json
└── vite.config.js
```

## 验证

KiCad 6 → KiCad 5 是唯一跨文件家族边界的转换，也是唯一对照**真实 KiCad 5** 行为做过检查的转换（其余路径仅做机械验证——能重新解析并写出正确的版本号）。由于仓库内没有真实的 KiCad 5 安装，K5 输出是对照 KiCad 的**自身源码与示例项目**验证的：

- **PCB / 封装** —— 规则通过把重新生成的板/封装按节点类型与 KiCad 自带的 `5.1/demos/video/video.kicad_pcb` 逐一对比，并对照 5.1 的 `PCB_PARSER` 源码（严格的主解析器 vs 宽松的 `pcbplotparams`）推导而来。由此发现并修复了 `(host …)` 文件头、`(paper)`→`(page)`、`User.1`–`User.9` 层移除、图形 `(fill)`、模型 `(offset)`→`(at)`、板级 `(group)`、含括号的封装名加引号，以及尺寸标注等问题。**整板语法审计**（顶层节点类型 + 每个 `(module)` 子项对照 KiCad 5 接受的 token 集）能从结构上一次性排查，而不是一个加载报错排查一轮。`test-k5-pcb-synth.mjs` 在不依赖（被 gitignore 的）素材文件的前提下锁定每条 PCB 规则。
- **原理图 / 符号** —— 元件方向/镜像矩阵、符号圆弧、标签方向均对照 KiCad 6/5.1 源码（`sch_symbol.cpp`、`sch_sexpr_parser.cpp`、`sch_legacy_plugin.cpp`）以及对应的传统示例图纸验证；缓存符号命名对照 `SCH_COMPONENT::Resolve` 验证。

运行全部验证脚本：

```bash
for t in test-k6k5 test-k5-pcb-synth check-k5-header test-cache-match test-consolidate test-orient test-arc-roundtrip test-label-orient; do node scripts/$t.mjs; done
```

> 仍为尽力而为（无 KiCad 5 真值可对照）：层次图纸的**图纸引脚**方位字母，以及被丢弃的 PCB 参数化**尺寸标注**（删除而非重绘）。

## 示例文件

`asset/` 目录下提供了用于测试和验证的示例文件：

### 原理图示例

- **`asset/kicad8/`** — KiCad 8 格式的原理图和 PCB 文件
- **`asset/kicad9/`** — KiCad 9 格式的原理图和 PCB 文件（与 kicad8 中的设计内容相同，仅版本不同）

两个文件夹中包含了相同的设计项目（原理图 + PCB），方便对比验证转换结果的正确性：

| 项目 | 说明 |
|------|------|
| `complex_hierarchy/` | 复杂层级原理图 |
| `flat_hierarchy/` | 扁平层级原理图 |
| `pic_programmer/` | PIC 编程器（含多页原理图） |
| `video/` | 视频电路设计 |

> **注意**：`kicad9/` 中还额外包含一个 `multichannel/` 项目，该设计使用了 KiCad 9 独有的多通道功能，在 KiCad 8 中无对应设计。
>
> `asset/wrongcase/` 目录下存放了用于发现和修复边际案例的测试文件。

### 符号库示例

- **`asset/kicad9/Symbol_v9/`** — KiCad 9 格式的符号库（`.kicad_sym`），共 229 个库文件
- **`asset/kicad8/Symbol_v8/`** — KiCad 8 格式的符号库，共 230 个库文件
- **`asset/kicad7/Symbol_v7/`** — KiCad 7 格式的符号库，共 227 个库文件

三个版本包含相同的符号库内容（如 `Buffer.kicad_sym`、`power.kicad_sym`、`Device.kicad_sym` 等），可用于对比验证符号库转换的正确性。

- **`asset/kicad10/kicad-symbols-10.0.0-rc2/`** — KiCad 10 格式的符号库（`.kicad_symdir` 目录格式，每个符号独立文件）

### 封装示例

- **`asset/kicad9/kicad-footprints-9.0.7/`** — KiCad 9 格式的官方封装库
- **`asset/kicad8/kicad-footprints-v8/`** — KiCad 8 格式的官方封装库
- **`asset/kicad7/kicad-footprints-v7/`** — KiCad 7 格式的官方封装库

三个版本均为 KiCad 官方封装库，包含 `Capacitor_SMD.pretty`、`Connector_USB.pretty` 等分类目录，可用于对比验证封装转换的正确性。

- **`asset/kicad10/kicad-footprints-10.0.0-rc2/`** — KiCad 10 格式的官方封装库
