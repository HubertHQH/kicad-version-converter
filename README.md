# KiCad Multi-Version Converter

一个基于浏览器的工具，用于将 KiCad 原理图文件（`.kicad_sch`）、符号库文件（`.kicad_sym`）和 PCB 文件（`.kicad_pcb`）进行版本降级转换，支持以下转换路径：

- **KiCad 9 → KiCad 8**
- **KiCad 8 → KiCad 7**
- **KiCad 9 → KiCad 7**（链式转换：先 9→8，再 8→7）

## 功能特性

- **浏览器端转换**：纯前端实现，无需服务器，文件不会上传到任何地方
- **三种文件类型**：支持 `.kicad_sch`（原理图）、`.kicad_sym`（符号库）和 `.kicad_pcb`（PCB）
- **批量处理**：支持同时上传多个文件，一键转换并打包下载
- **自动检测**：自动检测文件类型和版本，使用对应的转换规则
- **链式降级**：KiCad 9 → KiCad 7 会自动执行两步转换
- **转换日志**：显示详细的转换过程日志和警告信息

## 转换规则

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

### PCB (.kicad_pcb) — KiCad 9 → KiCad 8（P1-P9, P21-P22）

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
| P21 | dimension style 中移除 `(arrow_direction ...)` 并修复 `(keep_text_aligned yes)` → 裸原子 |
| P22 | 移除 zone 中的 `(placement ...)`（KiCad 9 多通道自动放置区域功能，K8 不支持） |

### PCB (.kicad_pcb) — KiCad 8 → KiCad 7（P10-P20）

| 规则 | 说明 |
|------|------|
| P10 | 文件头降级（`version` → `20221018`，移除 `generator_version`，`generator` 去引号） |
| P11 | `(uuid "xxx")` → `(tstamp xxx)`（全局递归） |
| P12 | `(property "Reference" ...)` → `(fp_text reference ...)` |
| P13 | `(property "Value" ...)` → `(fp_text value ...)` |
| P14 | 移除 `(property "Footprint"/"Datasheet"/"Description" ...)` |
| P15 | `(sheetname ...)`/`(sheetfile ...)` → `(property "Sheetname"/"Sheetfile" ...)` |
| P16 | `(locked yes)` 子节点 → footprint 行上的裸 `locked` 原子 |
| P17 | 移除 `general` 中的 `(legacy_teardrops ...)` |
| P18 | 移除 `setup` 中的 `(allow_soldermask_bridges_in_footprints ...)` |
| P19 | `pcbplotparams` 中布尔值 `yes/no` → `true/false` |
| P20 | 移除 K8 新增 pcbplotparams（`pdf_front/back_fp_property_popups`、`plotfptext`） |

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
- **Converter** — 基于 AST 的版本转换引擎（`src/lib/converter.js` + `src/lib/sym-converter.js` + `src/lib/pcb-converter.js`）

## 项目结构

```
converter/
├── src/
│   ├── lib/
│   │   ├── sexpr-parser.js   # S-expression 解析器和序列化器
│   │   ├── converter.js      # 统一转换入口 + 原理图转换规则
│   │   ├── sym-converter.js  # 符号库转换规则
│   │   └── pcb-converter.js  # PCB 转换规则
│   ├── App.jsx               # 主应用组件（文件上传、转换、下载）
│   └── main.jsx              # 入口文件
├── index.html
├── package.json
└── vite.config.js
```

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
