/**
 * SQL / DBML module messages, namespace `issues`:
 *  - DDL generation: `ddl.<dialect>.<code>` is stored once as `issues.ddl.<code>` (+ `.<part>.<dialect>` variants); `{dialect}` is
 *    the localised dialect name, `{dialectName}` the raw id the English text uses.
 *  - SQL / DBML import warnings: `{at}` = "(line L, column C)"; the suggestion is shared (`issues.import.suggestion`).
 *  - DBML export omissions: shared suggestion `issues.dbml-export.suggestion`.
 * English reproduces src/sql exactly (messages.test.ts).
 */
import { fromRows, issue, variant, type Row } from '../build';
import { defineMessages } from '../core';

const ddl: Row[] = [
  ...(
    [
      ['postgresql', 'PostgreSQL', 'PostgreSQL'],
      ['mysql', 'MySQL', 'MySQL'],
      ['sqlite', 'SQLite', 'SQLite'],
      ['generic', 'standard SQL', '通用 SQL'],
    ] as const
  ).map(([id, en, zh]): Row => [`dialect.${id}`, en, zh]),
  ...(
    [
      ['table', 'table', '表'],
      ['column', 'column', '列'],
      ['index', 'index', '索引'],
      ['unique-constraint', 'unique constraint', '唯一约束'],
      ['check-constraint', 'check constraint', '检查约束'],
      ['foreign-key', 'foreign key', '外键'],
      ['primary-key', 'primary key', '主键'],
    ] as const
  ).map(([id, en, zh]): Row => [`kind.${id}`, en, zh]),

  // names
  variant('ddl.empty-name', 'title', 'relation', 'Relation without a name', '关系模式没有名称'),
  variant('ddl.empty-name', 'explanation', 'relation', 'A table needs a name to be emitted as DDL.', '要生成 DDL，表必须有名称。'),
  variant('ddl.empty-name', 'suggestion', 'relation', 'Name the relation.', '为该关系模式命名。'),
  variant('ddl.empty-name', 'title', 'column', 'Column without a name', '列没有名称'),
  variant('ddl.empty-name', 'explanation', 'column', 'A column of "{relation}" has an empty name.', '“{relation}”中有一列的名称为空。'),
  variant('ddl.empty-name', 'suggestion', 'column', 'Name the column.', '为该列命名。'),
  variant('ddl.duplicate-name', 'title', 'table', 'Duplicate table name', '表名重复'),
  variant(
    'ddl.duplicate-name',
    'explanation',
    'table',
    'Two relations are both called "{name}"; identifiers are compared case-insensitively.',
    '有两个关系模式都叫“{name}”；标识符的比较不区分大小写。',
  ),
  variant(
    'ddl.duplicate-name',
    'explanation',
    'table.sqlite',
    'Two relations are both called "{name}" (SQLite ignores schema names here); identifiers are compared case-insensitively.',
    '有两个关系模式都叫“{name}”（SQLite 在这里忽略 schema 名）；标识符的比较不区分大小写。',
  ),
  variant('ddl.duplicate-name', 'suggestion', 'table', 'Rename one of the relations.', '重命名其中一个关系模式。'),
  variant('ddl.duplicate-name', 'title', 'column', 'Duplicate column name', '列名重复'),
  variant(
    'ddl.duplicate-name',
    'explanation',
    'column',
    '"{relation}" has two columns named "{name}" (names compare case-insensitively).',
    '“{relation}”中有两列都叫“{name}”（名称的比较不区分大小写）。',
  ),
  variant('ddl.duplicate-name', 'suggestion', 'column', 'Rename one of the columns.', '重命名其中一列。'),
  ...issue(
    'ddl.no-columns',
    ['Table without columns', '表没有任何列'],
    ['"{relation}" has no columns; no engine accepts an empty CREATE TABLE.', '“{relation}”没有任何列；没有数据库引擎接受空的 CREATE TABLE。'],
    ['Add at least one column.', '至少添加一列。'],
  ),
  ...issue(
    'ddl.empty-check',
    ['Empty CHECK expression', 'CHECK 表达式为空'],
    ['A CHECK constraint of "{relation}" has no expression.', '“{relation}”的一个 CHECK 约束没有表达式。'],
    ['Enter the boolean expression or delete the constraint.', '输入布尔表达式，或删除该约束。'],
  ),
  ...(['missing-column', 'repeated-column'] as const).flatMap((code): Row[] => {
    const missing = code === 'missing-column';
    const tail = missing ? ['refers to {count} column(s) that no longer exist.', '引用了 {count} 个已不存在的列。'] : ['lists the same column more than once.', '把同一列列出了不止一次。'];
    return [
      [`ddl.${code}.title`, missing ? 'Constraint references a missing column' : 'Column listed twice in a key', missing ? '约束引用了不存在的列' : '键中同一列出现了两次'],
      variant(`ddl.${code}`, 'explanation', 'primary', `The primary key of "{relation}" ${tail[0]}`, `“{relation}”的主键${tail[1]}`),
      variant(`ddl.${code}`, 'explanation', 'unique', `The unique constraint of "{relation}" ${tail[0]}`, `“{relation}”的唯一约束${tail[1]}`),
      variant(`ddl.${code}`, 'explanation', 'index', `The index {indexName} of "{relation}" ${tail[0]}`, `“{relation}”的索引 {indexName}${tail[1]}`),
      [
        `ddl.${code}.suggestion`,
        missing ? 'Remove the stale reference or restore the column.' : 'List each column once.',
        missing ? '移除失效的引用，或恢复该列。' : '每列只列出一次。',
      ],
    ];
  }),

  // foreign keys
  ...issue(
    'ddl.fk-missing-relation',
    ['Foreign key references a missing table', '外键引用了不存在的表'],
    ['The source or target relation of this foreign key does not exist.', '该外键的源关系模式或目标关系模式不存在。'],
    ['Delete the foreign key or restore the table.', '删除该外键，或恢复该表。'],
  ),
  ...issue(
    'ddl.fk-no-columns',
    ['Foreign key without columns', '外键没有列'],
    ['A foreign key from "{source}" to "{target}" has no column pairs.', '从“{source}”到“{target}”的外键没有列对。'],
    ['Add the column pairs or delete the foreign key.', '添加列对，或删除该外键。'],
  ),
  ...issue(
    'ddl.fk-missing-column',
    ['Foreign key references a missing column', '外键引用了不存在的列'],
    ['A column of the foreign key "{source}" → "{target}" no longer exists.', '外键“{source}”→“{target}”中的某一列已不存在。'],
    ['Re-select the columns or delete the foreign key.', '重新选择这些列，或删除该外键。'],
  ),
  ['ddl.fk-target-not-key.title', 'Foreign key does not reference a key', '外键引用的列不构成目标表的键'],
  variant(
    'ddl.fk-target-not-key',
    'explanation',
    'mysql',
    'The referenced columns of "{target}" are neither its primary key nor a UNIQUE constraint/index; InnoDB additionally needs an index that starts with exactly these columns. The engine rejects the constraint.',
    '“{target}”中被引用的列既不是它的主键，也不是 UNIQUE 约束/索引；InnoDB 还要求存在一个恰好以这些列开头的索引。数据库引擎会拒绝该约束。',
  ),
  variant(
    'ddl.fk-target-not-key',
    'explanation',
    'sqlite',
    'The referenced columns of "{target}" are neither its primary key nor a UNIQUE constraint/index. SQLite reports "foreign key mismatch" on the first write.',
    '“{target}”中被引用的列既不是它的主键，也不是 UNIQUE 约束/索引。SQLite 会在第一次写入时报告“foreign key mismatch”。',
  ),
  [
    'ddl.fk-target-not-key.explanation',
    'The referenced columns of "{target}" are neither its primary key nor a UNIQUE constraint/index. The engine rejects the constraint.',
    '“{target}”中被引用的列既不是它的主键，也不是 UNIQUE 约束/索引。数据库引擎会拒绝该约束。',
  ],
  [
    'ddl.fk-target-not-key.suggestion',
    'Reference the complete primary key (all columns of a composite key) or add a UNIQUE constraint on the referenced columns.',
    '引用完整的主键（复合主键的所有列），或在被引用的列上添加 UNIQUE 约束。',
  ],
  ['ddl.fk-type-mismatch.title', 'Foreign key column types differ', '外键列的类型不同'],
  variant(
    'ddl.fk-type-mismatch',
    'explanation',
    'postgresql',
    '{source} is {sourceType} but {target} is {targetType}. PostgreSQL rejects keys of incompatible types.',
    '{source} 的类型是 {sourceType}，而 {target} 的类型是 {targetType}。PostgreSQL 会拒绝类型不兼容的键。',
  ),
  variant(
    'ddl.fk-type-mismatch',
    'explanation',
    'mysql',
    '{source} is {sourceType} but {target} is {targetType}. MySQL requires identical integer types and compatible families.',
    '{source} 的类型是 {sourceType}，而 {target} 的类型是 {targetType}。MySQL 要求整数类型完全相同，其他类型属于兼容的类型族。',
  ),
  [
    'ddl.fk-type-mismatch.explanation',
    '{source} is {sourceType} but {target} is {targetType}. Engines compare such values with implicit conversions, which can hide mismatches.',
    '{source} 的类型是 {sourceType}，而 {target} 的类型是 {targetType}。数据库引擎会通过隐式转换来比较这类值，这可能掩盖类型不匹配。',
  ],
  ['ddl.fk-type-mismatch.suggestion', 'Give both columns the same type.', '让两列使用相同的类型。'],
  ...issue(
    'ddl.fk-set-default',
    ['SET DEFAULT is not supported by InnoDB', 'InnoDB 不支持 SET DEFAULT'],
    [
      'MySQL parses ON DELETE/UPDATE SET DEFAULT but InnoDB rejects the constraint.',
      'MySQL 能解析 ON DELETE/UPDATE SET DEFAULT，但 InnoDB 会拒绝该约束。',
    ],
    ['Use SET NULL, CASCADE or RESTRICT.', '改用 SET NULL、CASCADE 或 RESTRICT。'],
  ),
  ['ddl.fk-set-null-not-null.title', 'SET NULL on a NOT NULL column', 'NOT NULL 列上使用了 SET NULL'],
  [
    'ddl.fk-set-null-not-null.explanation',
    'The action can never succeed because a referencing column of "{source}" is NOT NULL.',
    '该动作永远无法成功，因为“{source}”的某个引用列是 NOT NULL。',
  ],
  variant(
    'ddl.fk-set-null-not-null',
    'explanation',
    'mysql',
    'The action can never succeed because a referencing column of "{source}" is NOT NULL; MySQL refuses to create the constraint.',
    '该动作永远无法成功，因为“{source}”的某个引用列是 NOT NULL；MySQL 会拒绝创建该约束。',
  ),
  [
    'ddl.fk-set-null-not-null.suggestion',
    'Make the column nullable or choose another referential action.',
    '将该列设为可空，或选择其他参照动作。',
  ],

  // types
  ...issue(
    'ddl.type-inherited',
    ['Column type taken from the referenced column', '列类型取自被引用的列'],
    [
      '"{relation}.{column}" has no type; it uses {type} from the column it references.',
      '“{relation}.{column}”没有指定类型；它使用所引用列的类型 {type}。',
    ],
    ['Set an explicit type to silence this note.', '指定一个明确的类型即可消除此提示。'],
  ),
  ['ddl.missing-type.title.single', 'Table {relation}: 1 column has no data type', '表 {relation}：有 1 列没有数据类型'],
  ['ddl.missing-type.title.multi', 'Table {relation}: {count} columns have no data type', '表 {relation}：有 {count} 列没有数据类型'],
  [
    'ddl.missing-type.explanation.single.fallback',
    '{columns} has no type, so {fallback} is emitted (the engine requires one).',
    '{columns} 没有指定类型，因此生成的 DDL 使用 {fallback}（数据库引擎要求必须有类型）。',
  ],
  [
    'ddl.missing-type.explanation.multi.fallback',
    '{columns} have no type, so {fallback} is emitted (the engine requires one).',
    '{columns} 没有指定类型，因此生成的 DDL 使用 {fallback}（数据库引擎要求必须有类型）。',
  ],
  [
    'ddl.missing-type.explanation.single.sqlite',
    '{columns} has no type; SQLite allows columns without a declared type (BLOB/none affinity).',
    '{columns} 没有指定类型；SQLite 允许列不声明类型（BLOB/无亲和性）。',
  ],
  [
    'ddl.missing-type.explanation.multi.sqlite',
    '{columns} have no type; SQLite allows columns without a declared type (BLOB/none affinity).',
    '{columns} 没有指定类型；SQLite 允许列不声明类型（BLOB/无亲和性）。',
  ],
  ['ddl.missing-type.suggestion.single', 'Choose a data type for the column.', '为该列选择一个数据类型。'],
  ['ddl.missing-type.suggestion.multi', 'Choose a data type for each of these columns.', '为这些列分别选择数据类型。'],
  ['ddl.type-not-portable.title', 'Data type not portable to {dialectName}', '数据类型无法移植到 {dialect}'],
  variant(
    'ddl.type-not-portable',
    'explanation',
    'mapped',
    '"{relation}.{column}" is declared {type}, which {dialectName} does not support; {suggested} is emitted instead.',
    '“{relation}.{column}”声明为 {type}，{dialect} 不支持该类型；已改为输出 {suggested}。',
  ),
  variant(
    'ddl.type-not-portable',
    'explanation',
    'verbatim',
    '"{relation}.{column}" is declared {type}, which {dialectName} does not know; it is written unchanged and {dialectName} will most likely reject it.',
    '“{relation}.{column}”声明为 {type}，{dialect} 不认识该类型；它被原样写出，{dialect} 很可能会拒绝执行。',
  ),
  [
    'ddl.type-not-portable.suggestion',
    'Change the column type to {suggested}, or define the type in {dialectName} before running the script.',
    '请将该列类型改为 {suggested}，或在运行脚本前先在 {dialect} 中定义该类型。',
  ],
  ['ddl.type-passthrough.title', 'Data type emitted verbatim', '数据类型按原样输出'],
  variant(
    'ddl.type-passthrough',
    'explanation',
    'modifier',
    '"{type}" is a type with modifiers; it is written to the {dialectName} DDL unchanged and not checked.',
    '“{type}”是带修饰符的类型；它会原样写入 {dialect} DDL，不做检查。',
  ),
  variant(
    'ddl.type-passthrough',
    'explanation',
    'unknown',
    '"{type}" is not a type SchemaCanvas knows; it is written to the {dialectName} DDL unchanged and not checked.',
    '“{type}”不是 SchemaCanvas 认识的类型；它会原样写入 {dialect} DDL，不做检查。',
  ),
  ['ddl.type-passthrough.suggestion', 'Make sure {dialectName} accepts this type.', '请确认 {dialect} 接受这种类型。'],
  ...issue(
    'ddl.varchar-length',
    ['VARCHAR without length', 'VARCHAR 没有指定长度'],
    ['MySQL requires a length; {sql} was emitted for "{relation}.{column}".', 'MySQL 要求指定长度；已为“{relation}.{column}”生成 {sql}。'],
    ['Give the column an explicit length such as VARCHAR(100).', '为该列指定明确的长度，例如 VARCHAR(100)。'],
  ),

  // identifiers
  ['ddl.identifier-too-long.title', 'Identifier too long', '标识符过长'],
  variant(
    'ddl.identifier-too-long',
    'explanation',
    'mysql',
    '"{name}" has {length} characters; MySQL allows at most {limit}.',
    '“{name}”有 {length} 个字符；MySQL 最多允许 {limit} 个。',
  ),
  [
    'ddl.identifier-too-long.explanation',
    '"{name}" is {length} bytes; PostgreSQL silently truncates identifiers to {limit} bytes, which can make two names collide.',
    '“{name}”长 {length} 字节；PostgreSQL 会悄悄地把标识符截断为 {limit} 字节，这可能使两个名称发生冲突。',
  ],
  variant('ddl.identifier-too-long', 'suggestion', 'mysql', 'Shorten the name to {limit} or fewer characters.', '将名称缩短到 {limit} 个字符以内。'),
  ['ddl.identifier-too-long.suggestion', 'Shorten the name to {limit} or fewer bytes.', '将名称缩短到 {limit} 字节以内。'],
  ...issue(
    'ddl.reserved-word',
    ['Name is a reserved word', '名称是保留字'],
    ['"{name}" is reserved in {dialectName}; it is emitted quoted.', '“{name}”在 {dialect} 中是保留字；生成时会加上引号。'],
    ['Rename it if you want to write queries without quoting.', '如果希望编写查询时不必加引号，请重命名它。'],
  ),
  ...issue(
    'ddl.schema-ignored',
    ['Schema name ignored', '忽略了 schema 名'],
    ['SQLite has no CREATE SCHEMA; the schema name is not emitted.', 'SQLite 没有 CREATE SCHEMA；不会输出 schema 名。'],
    ['Remove the schema name or target another dialect.', '移除 schema 名，或选择其他数据库方言。'],
  ),
  ...issue(
    'ddl.identifier-truncation-collision',
    ['Identifiers collide after truncation', '标识符截断后发生冲突'],
    [
      'PostgreSQL truncates identifiers to 63 bytes; "{first}" and "{second}" become the same name ({firstKind} / {secondKind}).',
      'PostgreSQL 会把标识符截断为 63 字节；“{first}”和“{second}”会变成同一个名称（{firstKind} / {secondKind}）。',
    ],
    ['Shorten the names so they differ within the first 63 bytes.', '缩短这些名称，使它们在前 63 字节内就有区别。'],
  ),
  ...issue(
    'ddl.duplicate-constraint-name',
    ['Name already used by another object', '名称已被另一个对象使用'],
    [
      '"{name}" is used as {firstKind} and as {secondKind} in the same namespace; the engine rejects the second definition.',
      '“{name}”在同一个命名空间中既用作{firstKind}，又用作{secondKind}；数据库引擎会拒绝第二个定义。',
    ],
    ['Give the constraint or index a unique name.', '为该约束或索引取一个唯一的名称。'],
  ),

  // auto-increment / defaults
  ...issue(
    'ddl.autoincrement-default',
    ['DEFAULT ignored on auto-increment column', '自增列上的 DEFAULT 被忽略'],
    [
      '"{relation}.{column}" is generated, so its DEFAULT is not emitted (the engine rejects both together).',
      '“{relation}.{column}”是自动生成的，因此不会输出它的 DEFAULT（数据库引擎不接受两者同时存在）。',
    ],
    ['Remove either the default or the auto-increment flag.', '去掉默认值或自增标记其中之一。'],
  ),
  variant('ddl.autoincrement-type', 'title', 'required', 'Auto-increment needs an integer type', '自增列需要整数类型'),
  variant(
    'ddl.autoincrement-type',
    'explanation',
    'required',
    '"{relation}.{column}" is {type}; auto-increment/identity columns must be SMALLINT, INTEGER or BIGINT.',
    '“{relation}.{column}”的类型是 {type}；自增/标识列必须是 SMALLINT、INTEGER 或 BIGINT。',
  ),
  variant(
    'ddl.autoincrement-type',
    'suggestion',
    'required',
    'Change the type to an integer type or clear the auto-increment flag.',
    '将类型改为整数类型，或清除自增标记。',
  ),
  variant('ddl.autoincrement-type', 'title', 'changed', 'Type changed to INTEGER for AUTOINCREMENT', '为 AUTOINCREMENT 将类型改为 INTEGER'),
  variant(
    'ddl.autoincrement-type',
    'explanation',
    'changed',
    'SQLite only makes a column a rowid alias when its declared type is exactly INTEGER; "{type}" was emitted as INTEGER (SQLite integers are 64-bit).',
    'SQLite 只有在声明类型恰好是 INTEGER 时，才会让该列成为 rowid 的别名；“{type}”已输出为 INTEGER（SQLite 的整数是 64 位的）。',
  ),
  variant('ddl.autoincrement-type', 'suggestion', 'changed', 'Declare the column INTEGER to silence this note.', '将该列声明为 INTEGER 即可消除此提示。'),
  ['ddl.autoincrement-pk.title', 'AUTOINCREMENT needs a single-column INTEGER PRIMARY KEY', 'AUTOINCREMENT 需要单列的 INTEGER PRIMARY KEY'],
  variant(
    'ddl.autoincrement-pk',
    'explanation',
    'composite',
    'SQLite only allows AUTOINCREMENT on a column that is the whole primary key; "{relation}.{column}" is part of a composite key.',
    'SQLite 只允许在恰好构成整个主键的列上使用 AUTOINCREMENT；“{relation}.{column}”是复合主键的一部分。',
  ),
  variant(
    'ddl.autoincrement-pk',
    'explanation',
    'notpk',
    'SQLite only allows AUTOINCREMENT on a column that is the whole primary key; "{relation}.{column}" is not the primary key.',
    'SQLite 只允许在恰好构成整个主键的列上使用 AUTOINCREMENT；“{relation}.{column}”不是主键。',
  ),
  [
    'ddl.autoincrement-pk.suggestion',
    'Make this column the sole primary key or clear the auto-increment flag.',
    '将该列设为唯一的主键，或清除自增标记。',
  ],
  ...issue(
    'ddl.autoincrement-key',
    ['AUTO_INCREMENT column must lead a key', 'AUTO_INCREMENT 列必须是某个键的首列'],
    [
      'MySQL requires the AUTO_INCREMENT column "{relation}.{column}" to be the first column of an index (typically the primary key).',
      'MySQL 要求 AUTO_INCREMENT 列“{relation}.{column}”必须是某个索引（通常是主键）的第一列。',
    ],
    ['Make it the first primary-key column or add a UNIQUE constraint on it.', '将它设为主键的第一列，或为它添加 UNIQUE 约束。'],
  ),
  ...issue(
    'ddl.autoincrement-multiple',
    ['Several AUTO_INCREMENT columns', '有多个 AUTO_INCREMENT 列'],
    [
      'MySQL allows only one AUTO_INCREMENT column per table; "{relation}" has several.',
      'MySQL 每个表只允许一个 AUTO_INCREMENT 列；“{relation}”有多个。',
    ],
    ['Keep the flag on one column.', '只在其中一列上保留该标记。'],
  ),
  ['ddl.default-parenthesised.title', 'DEFAULT wrapped in parentheses', 'DEFAULT 被加上了括号'],
  variant(
    'ddl.default-parenthesised',
    'explanation',
    'plain',
    '{engine} only accepts a plain literal after DEFAULT; the default of "{relation}.{column}" was emitted as ({value}).',
    '{engine} 在 DEFAULT 后只接受普通的字面量；“{relation}.{column}”的默认值已输出为 ({value})。',
  ),
  variant(
    'ddl.default-parenthesised',
    'explanation',
    'lob',
    '{engine} only accepts a plain literal after DEFAULT, and never for TEXT/BLOB/JSON columns; the default of "{relation}.{column}" was emitted as ({value}).',
    '{engine} 在 DEFAULT 后只接受普通的字面量，并且对 TEXT/BLOB/JSON 列一律不接受字面量；“{relation}.{column}”的默认值已输出为 ({value})。',
  ),
  ['ddl.default-parenthesised.suggestion', 'None needed.', '无需处理。'],
  ...issue(
    'ddl.pk-name-ignored',
    ['Primary key name ignored', '主键名称被忽略'],
    ['MySQL always names the primary key PRIMARY; the given name is not emitted.', 'MySQL 总是把主键命名为 PRIMARY；指定的名称不会输出。'],
    ['None needed.', '无需处理。'],
  ),
  ...issue(
    'ddl.key-lob-column',
    ['TEXT/BLOB/JSON column used in a key', '键中使用了 TEXT/BLOB/JSON 列'],
    [
      'MySQL cannot index "{relation}.{column}" ({type}) without a prefix length, which SchemaCanvas does not model.',
      'MySQL 不能在不指定前缀长度的情况下为“{relation}.{column}”（{type}）建立索引，而 SchemaCanvas 不支持前缀长度。',
    ],
    ['Use VARCHAR(n) (or VARBINARY) for key columns.', '键列请使用 VARCHAR(n)（或 VARBINARY）。'],
  ),
  ...issue(
    'ddl.key-too-long',
    ['Key exceeds the MySQL 3072-byte limit', '键超出 MySQL 的 3072 字节限制'],
    [
      'The {kind} on "{relation}" ({columns}) needs {bytes} bytes with its untyped columns as VARCHAR(255), more than InnoDB\'s 3072-byte limit, and shortening only the untyped columns (to at least {floor} characters) cannot make it fit. MySQL will reject the table (error 1071).',
      '“{relation}”上的{kind}（{columns}）在未指定类型的列取 VARCHAR(255) 时需要 {bytes} 字节，超过 InnoDB 的 3072 字节限制；仅缩短未指定类型的列（最短 {floor} 个字符）也无法使其满足限制。MySQL 会拒绝创建该表（错误 1071）。',
    ],
    ['Give the key columns shorter explicit types such as VARCHAR(100), or use fewer or narrower key columns.', '请为键列指定更短的显式类型（如 VARCHAR(100)），或减少键列数量、使用更窄的列。'],
  ),

  variant(
    'ddl.key-too-long',
    'explanation',
    'typed',
    'The {kind} on "{relation}" ({columns}) needs {bytes} bytes at 4 bytes per utf8mb4 character, more than InnoDB\'s 3072-byte limit. MySQL will reject the table (error 1071).',
    '“{relation}”上的{kind}（{columns}）按每个 utf8mb4 字符 4 字节计需要 {bytes} 字节，超过 InnoDB 的 3072 字节限制。MySQL 会拒绝创建该表（错误 1071）。',
  ),
  variant(
    'ddl.key-too-long',
    'suggestion',
    'typed',
    'Give the key columns shorter explicit types such as VARCHAR(100), or use fewer or narrower key columns.',
    '请为键列指定更短的显式类型（如 VARCHAR(100)），或减少键列数量、使用更窄的列。',
  ),

  // unsafe free text, unsupported defaults, out-of-range type parameters
  variant('ddl.unsafe-sql-text', 'title', 'type', 'Unsafe data type text', '数据类型文本不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'default', 'Unsafe DEFAULT text', 'DEFAULT 文本不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'check', 'Unsafe CHECK text', 'CHECK 文本不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'where', 'Unsafe WHERE text', 'WHERE 文本不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'action', 'Unsafe referential action', '引用动作不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'method', 'Unsafe index method', '索引方法不安全'),
  variant('ddl.unsafe-sql-text', 'title', 'identifier', 'Unsafe name', '名称不安全'),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'type',
    'The data type of "{relation}.{column}" contains characters or constructs that are not allowed in this field (only identifiers, numbers, quoted literals, simple operators and parentheses; no semicolons, comments, dollar quoting, brackets or backslash escapes) or unbalanced quotes/parentheses, so it is not written into the script.',
    '“{relation}.{column}”的数据类型含有此处不允许的字符或结构（只允许标识符、数字、带引号的字面量、简单运算符和括号；不允许分号、注释、美元引用、方括号或反斜杠转义）或不成对的引号/括号，因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'default',
    'The DEFAULT of "{relation}.{column}" contains characters or constructs that are not allowed in this field (only identifiers, numbers, quoted literals, simple operators and parentheses; no semicolons, comments, dollar quoting, brackets or backslash escapes) or unbalanced quotes/parentheses, so it is not written into the script.',
    '“{relation}.{column}”的 DEFAULT 含有此处不允许的字符或结构（只允许标识符、数字、带引号的字面量、简单运算符和括号；不允许分号、注释、美元引用、方括号或反斜杠转义）或不成对的引号/括号，因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'check',
    'The CHECK expression of "{relation}" contains characters or constructs that are not allowed in this field (only identifiers, numbers, quoted literals, simple operators and parentheses; no semicolons, comments, dollar quoting, brackets or backslash escapes) or unbalanced quotes/parentheses, so it is not written into the script.',
    '“{relation}”的 CHECK 表达式含有此处不允许的字符或结构（只允许标识符、数字、带引号的字面量、简单运算符和括号；不允许分号、注释、美元引用、方括号或反斜杠转义）或不成对的引号/括号，因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'where',
    'The WHERE predicate of index "{name}" on "{relation}" contains characters or constructs that are not allowed in this field (only identifiers, numbers, quoted literals, simple operators and parentheses; no semicolons, comments, dollar quoting, brackets or backslash escapes) or unbalanced quotes/parentheses, so it is not written into the script.',
    '“{relation}”上索引“{name}”的 WHERE 谓词含有此处不允许的字符或结构（只允许标识符、数字、带引号的字面量、简单运算符和括号；不允许分号、注释、美元引用、方括号或反斜杠转义）或不成对的引号/括号，因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'action',
    'A referential action of a foreign key on "{relation}" ("{value}") is not one of CASCADE, SET NULL, SET DEFAULT, RESTRICT, NO ACTION, so it is not written into the script.',
    '“{relation}”上外键的引用动作（“{value}”）不是 CASCADE、SET NULL、SET DEFAULT、RESTRICT、NO ACTION 之一，因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'method',
    'The index method of "{name}" on "{relation}" is not a plain word (letters, digits and underscores), so it is not written into the script.',
    '“{relation}”上索引“{name}”的方法不是普通单词（仅限字母、数字和下划线），因此不会写入脚本。',
  ),
  variant(
    'ddl.unsafe-sql-text',
    'explanation',
    'identifier',
    'A name in "{relation}" contains a NUL byte, line break, other control character or (portable script) backslash, which cannot be written safely into the script.',
    '“{relation}”中的某个名称含有 NUL 字节、换行、其他控制字符或（通用脚本中的）反斜杠，无法安全写入脚本。',
  ),
  variant('ddl.unsafe-sql-text', 'suggestion', 'type', 'Replace it with a plain type such as VARCHAR(100).', '请改用普通类型，例如 VARCHAR(100)。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'default', 'Replace it with a plain literal or a single expression.', '请改用普通字面量或单个表达式。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'check', 'Replace it with a single boolean expression.', '请改用单个布尔表达式。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'where', 'Replace it with a single boolean expression.', '请改用单个布尔表达式。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'action', 'Choose one of the five standard referential actions.', '请选择五种标准引用动作之一。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'method', 'Use a method name such as btree or hash.', '请使用 btree、hash 之类的方法名。'),
  variant('ddl.unsafe-sql-text', 'suggestion', 'identifier', 'Remove the control characters and backslashes from the name.', '请删除名称中的控制字符和反斜杠。'),
  ...issue(
    'ddl.default-unsupported',
    ['DEFAULT not supported by MySQL', 'MySQL 不支持该 DEFAULT'],
    [
      'The default of "{relation}.{column}" ({value}) uses a PostgreSQL-only function or cast that MySQL does not have.',
      '“{relation}.{column}”的默认值（{value}）使用了 MySQL 没有的 PostgreSQL 专有函数或类型转换。',
    ],
    ['Use a literal, or a MySQL expression such as (UUID()).', '请使用字面量，或 MySQL 表达式，例如 (UUID())。'],
  ),
  ['ddl.type-out-of-range.title', 'Data type parameter out of range', '数据类型参数超出范围'],
  ...(
    [
      ['length', 'allows a length of at most {max}', '允许的长度最大为 {max}'],
      ['precision', 'allows a precision of at most {max}', '允许的精度最大为 {max}'],
      ['scale', 'allows a scale of at most {max}', '允许的小数位数最大为 {max}'],
      ['scale-gt-precision', 'requires the scale to be at most the precision', '要求小数位数不超过精度'],
      ['float', 'allows FLOAT(p) only up to p = {max}', '只允许 FLOAT(p) 的 p 不超过 {max}'],
      ['fsp', 'allows fractional-seconds precision up to {max}', '允许的小数秒精度最大为 {max}'],
    ] as const
  ).map(([id, en, zh]): Row => [
    `ddl.type-out-of-range.explanation.${id}`,
    `"{relation}.{column}" is declared {type}, but {dialectName} ${en}; the server rejects the column.`,
    `“{relation}.{column}”声明为 {type}，但 {dialect} ${zh}；服务器会拒绝该列。`,
  ]),
  ['ddl.type-out-of-range.suggestion', 'Use a value within the engine limit.', '请使用引擎限制范围内的值。'],

  // indexes
  ['ddl.duplicate-index-name.title', 'Duplicate index name', '索引名称重复'],
  variant(
    'ddl.duplicate-index-name',
    'explanation',
    'mysql',
    'Index name "{name}" is used twice on the same table.',
    '索引名“{name}”在同一个表中被使用了两次。',
  ),
  [
    'ddl.duplicate-index-name.explanation',
    'Index name "{name}" is used twice in the same schema.',
    '索引名“{name}”在同一个 schema 中被使用了两次。',
  ],
  ['ddl.duplicate-index-name.suggestion', 'Rename one of the indexes.', '重命名其中一个索引。'],
  ...issue(
    'ddl.partial-index',
    ['Partial index omitted', '省略了部分索引'],
    [
      'MySQL has no partial indexes; index "{name}" (WHERE {where}) was not emitted instead of being widened to the whole table.',
      'MySQL 没有部分索引；索引“{name}”（WHERE {where}）没有输出，而不是被放宽为覆盖整张表。',
    ],
    ['Drop the WHERE clause deliberately or use a different engine.', '有意识地去掉 WHERE 子句，或改用其他数据库引擎。'],
  ),
  ['ddl.index-method-ignored.title', 'Index method ignored', '忽略了索引方法'],
  variant(
    'ddl.index-method-ignored',
    'explanation',
    'sqlite',
    'SQLite has a single index type; USING {method} on "{name}" was dropped.',
    'SQLite 只有一种索引类型；“{name}”上的 USING {method} 被丢弃了。',
  ),
  variant(
    'ddl.index-method-ignored',
    'explanation',
    'generic',
    'Standard SQL has no index method; USING {method} on "{name}" was dropped.',
    '标准 SQL 没有索引方法；“{name}”上的 USING {method} 被丢弃了。',
  ),
  variant('ddl.index-method-ignored', 'suggestion', 'sqlite', 'None needed.', '无需处理。'),
  variant('ddl.index-method-ignored', 'suggestion', 'generic', 'Pick a concrete dialect to keep it.', '选择一种具体的数据库方言即可保留它。'),
  ...issue(
    'ddl.unique-index-method',
    ['Unique index with a non-btree method', '唯一索引使用了非 btree 方法'],
    [
      'PostgreSQL only supports UNIQUE indexes with the btree method; "{name}" uses {method}.',
      'PostgreSQL 只支持使用 btree 方法的 UNIQUE 索引；“{name}”使用的是 {method}。',
    ],
    ['Use USING btree or drop the uniqueness.', '改用 USING btree，或去掉唯一性。'],
  ),
  ...issue(
    'ddl.index-method-hash',
    ['HASH index is not honoured by InnoDB', 'InnoDB 不支持 HASH 索引'],
    ['InnoDB silently builds "{name}" as a BTREE index.', 'InnoDB 会悄悄地把“{name}”建成 BTREE 索引。'],
    ['Use BTREE (the effective type) to make the DDL honest.', '使用 BTREE（实际生效的类型），让 DDL 与实际行为一致。'],
  ),
];

/** `[code, en title, en explanation, zh title, zh explanation]`; `{at}` closes every explanation. */
type ImportRow = [string, string, string, string, string];
const imp = (ns: 'sql.import' | 'dbml.import', rows: ImportRow[]): Row[] =>
  rows.flatMap(([code, et, ee, zt, ze]): Row[] => [
    [`${ns}.${code}.title`, et, zt],
    [`${ns}.${code}.explanation`, `${ee} {at}`, `${ze}{at}`],
  ]);

const sqlImport: Row[] = [
  ...imp('sql.import', [
    ['skipped-statement', '{construct} skipped', 'The {construct} does not describe a table and was not imported.', '已跳过 {construct}', '该 {construct} 并不描述表，因此没有导入。'],
    ['temporary-table', 'Temporary/unlogged table imported as a normal table', 'TEMPORARY/UNLOGGED has no representation in the model.', '临时/unlogged 表被导入为普通表', 'TEMPORARY/UNLOGGED 在模型中没有对应的表示。'],
    ['duplicate-table', 'Duplicate table skipped', 'Table {name} was already defined; the IF NOT EXISTS duplicate was ignored.', '已跳过重复的表', '表 {name} 已经定义过；带 IF NOT EXISTS 的重复定义被忽略。'],
    ['skipped-index', '{construct} index skipped', '{construct} indexes are not representable and were not imported.', '已跳过 {construct} 索引', '{construct} 索引无法表示，因此没有导入。'],
    [
      'mysql-serial',
      'SERIAL expanded',
      'In MySQL SERIAL means BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE; the type and the UNIQUE constraint were imported explicitly.',
      'SERIAL 已展开',
      '在 MySQL 中，SERIAL 表示 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE；类型和 UNIQUE 约束已分别明确导入。',
    ],
    ['deferrable', 'DEFERRABLE ignored', 'Constraint deferrability is not modelled.', '忽略了 DEFERRABLE', '约束的可延迟性不在模型的表示范围内。'],
    ['collation', 'Collation ignored', 'COLLATE {collation} on {relation}.{columnName} is not modelled.', '忽略了排序规则', '{relation}.{columnName} 上的 COLLATE {collation} 不在模型的表示范围内。'],
    ['charset', 'Character set ignored', 'CHARACTER SET on {relation}.{columnName} is not modelled.', '忽略了字符集', '{relation}.{columnName} 上的 CHARACTER SET 不在模型的表示范围内。'],
    ['on-update', 'ON UPDATE ignored', 'ON UPDATE of {relation}.{columnName} is not modelled.', '忽略了 ON UPDATE', '{relation}.{columnName} 的 ON UPDATE 不在模型的表示范围内。'],
    [
      'fk-match',
      'FOREIGN KEY MATCH clause ignored',
      'MATCH {match} is not modelled (the default MATCH SIMPLE semantics apply).',
      '忽略了 FOREIGN KEY 的 MATCH 子句',
      'MATCH {match} 不在模型的表示范围内（按默认的 MATCH SIMPLE 语义处理）。',
    ],
    ['key-order', 'Key column order ignored', 'DESC on a key column is not modelled for constraints.', '忽略了键列顺序', '约束中键列上的 DESC 不在模型的表示范围内。'],
    ['nulls-order', 'NULLS FIRST/LAST ignored', 'NULLS ordering of an index column is not modelled.', '忽略了 NULLS FIRST/LAST', '索引列的 NULLS 排序不在模型的表示范围内。'],
    ['check-not-enforced', 'NOT ENFORCED ignored', 'The CHECK constraint is imported as enforced.', '忽略了 NOT ENFORCED', '该 CHECK 约束按“强制执行”导入。'],
    ['index-method', 'Index method ignored', 'USING {method} on a constraint is not modelled.', '忽略了索引方法', '约束上的 USING {method} 不在模型的表示范围内。'],
    ['index-comment', 'Index comment ignored', 'COMMENT on an index is not modelled.', '忽略了索引注释', '索引上的 COMMENT 不在模型的表示范围内。'],
    ['index-prefix', 'Index prefix length ignored', '{columnName}({prefix}) was imported as the full column.', '忽略了索引前缀长度', '{columnName}({prefix}) 已按完整的列导入。'],
    [
      'table-options',
      'Table options skipped',
      'Table options after the column list were not imported: {options}',
      '已跳过表选项',
      '列定义之后的表选项没有导入：{options}',
    ],
    ['owner', 'OWNER TO ignored', 'Table ownership is not modelled.', '忽略了 OWNER TO', '表的拥有者不在模型的表示范围内。'],
    ['alter-ignored', 'ALTER TABLE option ignored', '{construct} ... is not modelled.', '忽略了 ALTER TABLE 选项', '{construct} …… 不在模型的表示范围内。'],
    ['index-options', 'Index options skipped', 'Index options starting at {construct} were not imported.', '已跳过索引选项', '从 {construct} 开始的索引选项没有导入。'],
    [
      'fk-target-not-key',
      'Foreign key does not reference a key',
      'The columns of {target} referenced from {source} are neither its primary key nor a UNIQUE constraint; most engines reject this.',
      '外键引用的列不构成键',
      '从 {source} 引用的 {target} 的列既不是主键，也不是 UNIQUE 约束；大多数数据库引擎会拒绝这样的外键。',
    ],
    [
      'skipped-comment',
      'Conditional comment ignored',
      'MySQL conditional comment /*! ... */ was treated as a comment; its content was not imported',
      '忽略了条件注释',
      'MySQL 条件注释 /*! ... */ 被当作注释处理；其中的内容没有导入',
    ],
  ]),
  ...imp('dbml.import', [
    ['table-setting', 'Table setting ignored', 'The table setting "{construct}" is not modelled.', '忽略了表设置', '表设置“{construct}”不在模型的表示范围内。'],
    [
      'column-setting',
      'Column setting ignored',
      'The column setting "{construct}" on {relation}.{columnName} is not modelled.',
      '忽略了列设置',
      '{relation}.{columnName} 上的列设置“{construct}”不在模型的表示范围内。',
    ],
    [
      'expression-index',
      'Expression index skipped',
      'The index expression `{expression}` on {relation} cannot be modelled as columns.',
      '已跳过表达式索引',
      '{relation} 上的索引表达式 `{expression}` 无法建模为列。',
    ],
    ['index-setting', 'Index setting ignored', 'The index setting "{construct}" is not modelled.', '忽略了索引设置', '索引设置“{construct}”不在模型的表示范围内。'],
    ['ref-setting', 'Ref setting ignored', 'The Ref setting "{construct}" is not modelled.', '忽略了 Ref 设置', 'Ref 设置“{construct}”不在模型的表示范围内。'],
    [
      'fk-target-not-key',
      'Reference does not target a key',
      'The referenced columns of {target} are neither its primary key nor unique; most engines reject this foreign key.',
      '引用的列不构成键',
      '{target} 的被引用列既不是主键，也不是唯一列；大多数数据库引擎会拒绝这样的外键。',
    ],
    [
      'many-to-many',
      'Many-to-many turned into a junction table',
      'DBML "<>" has no foreign key; table {relation} with a composite primary key and two foreign keys was generated.',
      '多对多已转换为联结表',
      'DBML 的 "<>" 没有外键；已生成表 {relation}，它带有复合主键和两个外键。',
    ],
  ]),
  // skipped-block: the explanation depends on the block kind
  ['dbml.import.skipped-block.title', '{construct} block ignored', '已忽略 {construct} 块'],
  variant(
    'dbml.import.skipped-block',
    'explanation',
    'enum',
    'Enum types are not modelled; columns keep the enum name as their data type. {at}',
    'DBML 中的 Enum 类型不在模型的表示范围内；列以枚举名称作为其数据类型。{at}',
  ),
  variant(
    'dbml.import.skipped-block',
    'explanation',
    'project',
    'The Project block (database type, notes) is not imported. {at}',
    'Project 块（数据库类型、备注）没有导入。{at}',
  ),
  variant('dbml.import.skipped-block', 'explanation', 'generic', 'The {construct} block is not imported. {at}', '{construct} 块没有导入。{at}'),
  [
    'import.suggestion',
    'Review the imported schema; remove or rewrite the construct if it matters.',
    '请检查导入的模型；如果这个语法结构很重要，请将它移除或改写。',
  ],
  collapseCollation(),
];

/** `collation` has a second text (a key column): add it as the `key` variant of the explanation. */
function collapseCollation(): Row {
  return variant('sql.import.collation', 'explanation', 'key', 'COLLATE on a key column is not modelled. {at}', '键列上的 COLLATE 不在模型的表示范围内。{at}');
}

const dbmlExport: Row[] = [
  ['dbml-export.suggestion', 'DBML cannot express this; it is omitted from the export.', 'DBML 无法表达这一点，因此导出时省略了它。'],
  ...(
    [
      [
        'default-quote',
        'Default dropped',
        'The default of {relation}.{column} is a text literal containing a single quote; downstream DBML converters cannot write that safely, so it is omitted.',
        '省略了默认值',
        '{relation}.{column} 的默认值是含有单引号的文本字面量；下游 DBML 转换器无法安全地写出它，因此已省略。',
      ],
      [
        'default',
        'Default dropped',
        'The default of {relation}.{column} is not a plain SQL expression (only identifiers, numbers, quoted literals, simple operators and parentheses are exported) and cannot be written as a DBML expression.',
        '省略了默认值',
        '{relation}.{column} 的默认值不是普通 SQL 表达式（只导出标识符、数字、带引号的字面量、简单运算符和括号），无法写成 DBML 表达式。',
      ],
      [
        'type',
        'Unsafe data type replaced',
        'The data type of {relation}.{column} is not a plain SQL type, so it was replaced by text in the DBML; set a plain type to keep it.',
        '不安全的数据类型已被替换',
        '{relation}.{column} 的数据类型不是普通 SQL 类型，因此在 DBML 中替换为 text；请改用普通类型以保留它。',
      ],
      [
        'missing-type',
        'Column type defaulted to text',
        '{relation}.{column} has no data type; DBML requires one, so "text" was written.',
        '列类型默认为 text',
        '{relation}.{column} 没有数据类型；DBML 要求必须有类型，因此写入了“text”。',
      ],
      [
        'partial-index',
        'Partial index predicate dropped',
        'Index {index} on {relation} has a WHERE predicate, which DBML cannot express.',
        '省略了部分索引的条件',
        '{relation} 上的索引 {index} 带有 WHERE 条件，DBML 无法表达。',
      ],
      [
        'index-order',
        'Index column order dropped',
        'Index {index} on {relation} has DESC columns, which DBML cannot express.',
        '省略了索引列的排序方向',
        '{relation} 上的索引 {index} 含有 DESC 列，DBML 无法表达。',
      ],
      [
        'check',
        'CHECK dropped',
        'A CHECK of {relation} is not a plain SQL expression and cannot be written as a DBML expression.',
        '省略了 CHECK 约束',
        '{relation} 的一个 CHECK 约束不是普通 SQL 表达式，无法写成 DBML 表达式。',
      ],
      [
        'foreign-key',
        'Foreign key skipped',
        'A foreign key refers to a missing relation or has no columns.',
        '跳过了外键',
        '有一个外键引用了不存在的关系模式，或没有任何列。',
      ],
      [
        'text',
        'Characters replaced in a name or note',
        'A name or note of {relation} contained a quote, backtick, bracket or backslash, which downstream DBML converters do not escape safely: single quotes became ’ and the other characters underscores (a suffix keeps renamed names unique).',
        '名称或备注中的字符被替换',
        '{relation} 的某个名称或备注含有引号、反引号、方括号或反斜杠，下游 DBML 转换器无法安全转义：单引号已改为 ’，其他字符改为下划线（必要时加后缀以保持名称唯一）。',
      ],
      [
        'fk-label',
        'Foreign key label dropped',
        'The label "{label}" of a foreign key on {relation} has no DBML equivalent.',
        '省略了外键标签',
        '{relation} 上外键的标签“{label}”在 DBML 中没有对应的表示。',
      ],
    ] as const
  ).flatMap(([code, et, ee, zt, ze]): Row[] => [
    [`dbml.export.${code}.title`, et, zt],
    [`dbml.export.${code}.explanation`, ee, ze],
  ]),
];

export default defineMessages('issues', fromRows([...ddl, ...sqlImport, ...dbmlExport]));
