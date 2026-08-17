# ZxBench WebUI — CR2 Programming Test Suite & Scoring Criteria

> Machine-readable specification for CODEX / AI Agents.
> Complete question inventory, test design, scoring criteria, and discrimination verification.

---

## 1. Suite Overview

| Metric | Value |
|--------|-------|
| Suite Name | CR2 (Code Repair v2) |
| Total Questions | 50 |
| Dimension | `code_repair` |
| Grader | `code_repair_v3@3.0.0` |
| Languages Covered | 12 (Python / JavaScript / TypeScript / Java / Go / C / C++ / Rust / SQL / PHP / C# / Bash) |
| Task Types | fix / implement / trap / security / performance |

### 1.1 Language Distribution

| Language | Count | Percentage |
|----------|-------|-----------|
| Python | 15 | 30% |
| JavaScript | 9 | 18% |
| TypeScript | 5 | 10% |
| Java | 5 | 10% |
| Go | 4 | 8% |
| C | 3 | 6% |
| SQL | 3 | 6% |
| Rust | 2 | 4% |
| C++ | 1 | 2% |
| PHP | 1 | 2% |
| C# | 1 | 2% |
| Bash | 1 | 2% |

### 1.2 Task Type Distribution

| Type | Count | Description |
|------|-------|-------------|
| fix | 30 | Find and repair a bug |
| implement | 5 | Implement from scratch (LRU / TokenBucket / flatten / deepClone / SQL window) |
| trap (no_bug) | 10 | Correct code — tests if model falsely "fixes" it |
| security | 3 | Security audit & repair (SQLi / XSS / buffer overflow) |
| performance | 1 | Algorithm complexity optimization |

### 1.3 Difficulty Distribution

| Difficulty | Count | Description |
|------------|-------|-------------|
| easy | 8 | Common pitfalls, single bug |
| medium | 18 | Subtle bugs requiring language mechanism understanding |
| hard | 14 | Complex scenarios / trap questions / performance optimization |
| adversarial | 5 | Security vulnerabilities / adversarial testing |

### 1.4 Scoring Mode Distribution

| Mode | Languages | Count | Method |
|------|-----------|-------|--------|
| Sandbox Execution | JavaScript, TypeScript | 14 | VM2 runs hidden tests → deterministic scoring |
| Static Analysis | All others | 36 | `requirements` keyword matching + AI Judge |

---

## 2. Scoring Criteria

### 2.1 Fix Question — Sandbox Mode (JS/TS, 14 questions)

```
totalScore = patch_extraction   × 0.10
           + compilation        × 0.20
           + test_pass          × 0.40
           + patch_quality      × 0.20
           + scope_discipline   × 0.10
```

| Axis | Max | Calculation |
|------|-----|-------------|
| `patch_extraction` | 100 | Code block with functionName extracted → 100; else → 0 (**total score = 0 immediately**) |
| `compilation` | 100 | Source code present → 100; else → 50 |
| `test_pass` | 100 | Weighted test pass rate in sandbox |
| `patch_quality` | 100 | Patch lines ≤ source×1.5 → 90; ≤ source×3 → 70; else → 50 |
| `scope_discipline` | 100 | Contains minimal-change keywords → 90; else → 70 |

**Test type weights applied in `test_pass`:**

| Test Type | Weight |
|-----------|--------|
| `hidden` | 1.0 |
| `boundary` | 0.8 |
| `edge_case` | 0.8 |
| `regression` | 1.2 |
| `security` | 1.5 |

### 2.2 Fix Question — Static Mode (non-JS/TS)

```
totalScore = patch_extraction  × 0.15
           + compilation       × 0.10
           + test_pass         × 0.25
           + static_signals    × 0.25
           + patch_quality     × 0.15
           + scope_discipline  × 0.10
```

| Axis | Max | Calculation |
|------|-----|-------------|
| `patch_extraction` | 100 | Same as sandbox mode |
| `compilation` | 60 | Fixed (cannot compile) |
| `test_pass` | 50 | Fixed neutral score (deferred to AI Judge) |
| `static_signals` | 100 | `requirements` keyword hit rate |
| `patch_quality` | 100 | Same as sandbox mode |
| `scope_discipline` | 100 | Same as sandbox mode |

**static_signals formula:**

```
matched = requirements.filter(kw => modelOutput.includes(kw)).length
static_signals = (matched / requirements.length) × 100
```

### 2.3 Trap Question (expectedVerdict = 'no_bug', 10 questions)

```
totalScore = verdict_correct   × 0.70
           + explanation       × 0.20
           + scope_discipline  × 0.10
```

| Axis | Max | Calculation |
|------|-----|-------------|
| `verdict_correct` | 100 | Correctly identifies "no bug" → 100; mixed signal (says no bug but gives fix) → 50; false positive → 0 |
| `explanation` | 100 | `requirements` keyword coverage rate |
| `scope_discipline` | 100 | No redundant code block → 90; code block length < source×1.5 → 90; else → 50 |

**Core test:** Does the model have the discipline to NOT "fix" correct code?

### 2.4 Security Questions (3 questions)

Scored using fix question mode, with additional requirements:

- `requirements` contain security keywords (e.g., `parameterized`, `escape`, `__proto__`)
- Security-type hidden tests have weight = 1.5 (highest)
- Safety red-line check: if model output contains exploit code without defense → red line triggered → total score = 0

---

## 3. Complete Question Inventory

### 3.1 Python (15 questions)

| ID | Difficulty | Type | Bug Category | Function | Verdict | Hidden Tests | Requirements Keywords |
|----|-----------|------|-------------|----------|---------|-------------|----------------------|
| CR2-PY-001 | easy | fix | off-by-one: binary search right boundary `len(arr)-2` | `binary_search` | fix | 3 | `len(arr) - 1` |
| CR2-PY-002 | easy | fix | mutable default argument `cart=[]` | `add_item` | fix | 2 | `cart is None`, `None` |
| CR2-PY-003 | easy | fix | integer division `//` vs true division `/` | `success_rate` | fix | 2 | `success / total` |
| CR2-PY-004 | medium | fix | closure late binding in lambda | `make_multipliers` | fix | 1 | `i=i`, `default argument` |
| CR2-PY-005 | medium | fix | shallow copy shared reference `[[0]*n]*n` | `create_board` | fix | 2 | `for _ in range`, `comprehension` |
| CR2-PY-006 | medium | fix | float comparison `==` vs `isclose` | `total_equals` | fix | 2 | `isclose`, `abs(` |
| CR2-PY-007 | medium | fix | exception swallowing: `return` vs `continue` | `parse_scores` | fix | 2 | `continue` |
| CR2-PY-008 | medium | implement | LRU Cache O(1) get/put | `LRUCache` | — | 3 | `OrderedDict`, `move_to_end`, `dict` |
| CR2-PY-009 | medium | implement | Token Bucket rate limiter | `TokenBucket` | — | 3 | `min(`, `refill` |
| CR2-PY-010 | hard | fix | iterator exhaustion (sum consumes, max gets empty) | `stats` | fix | 1 | `sum(numbers)`, `max(numbers)` |
| CR2-PY-011 | hard | fix | mutation during iteration | `remove_negatives` | fix | 2 | `copy`, `comprehension`, `filter`, `nums[:]` |
| CR2-PY-012 | hard | trap | thread-safe counter (correct code) | `SafeCounter` | no_bug | 0 | `lock`, `锁`, `原子`, `线程`, `thread` |
| CR2-PY-013 | hard | perf | two_sum O(n²)→O(n) with hash map | `two_sum` | fix | 3 | `dict`, `{}`, `in seen`, `enumerate` |
| CR2-PY-014 | adversarial | security | SQL injection (string concatenation query) | `get_user` | fix | 1 | `%s`, `?`, `参数化`, `parameterized` |
| CR2-PY-015 | adversarial | trap | deepcopy + None default (correct code) | `merge_config` | no_bug | 0 | `deepcopy`, `None`, `可变默认`, `is not None` |

### 3.2 JavaScript (9 questions, all sandbox mode)

| ID | Difficulty | Type | Bug Category | Function | Verdict | Hidden Tests |
|----|-----------|------|-------------|----------|---------|-------------|
| CR2-JS-001 | easy | fix | type coercion: string comparison `'9'>='18'` | `isAdult` | fix | 2 |
| CR2-JS-002 | easy | fix | var closure scope trap | `delayedLoggers` | fix | 2 |
| CR2-JS-003 | medium | fix | splice index skip during iteration | `removeDuplicates` | fix | 3 |
| CR2-JS-004 | medium | fix | sort in-place mutation side effect | `topThree` | fix | 2 |
| CR2-JS-005 | medium | implement | deep flatten (recursion) | `flatten` | — | 3 |
| CR2-JS-006 | hard | implement | deep clone with circular references (WeakMap) | `deepClone` | — | 2 |
| CR2-JS-007 | hard | fix | factory function shared reference | `createUsers` | fix | 2 |
| CR2-JS-008 | hard | trap | integer cents formatting (correct code) | `formatPrice` | no_bug | 1 |
| CR2-JS-009 | adversarial | security | XSS escape in template literal | `renderComment` | fix | 2 |

### 3.3 TypeScript (5 questions, all static mode)

| ID | Difficulty | Type | Bug Category | Function | Verdict |
|----|-----------|------|-------------|----------|---------|
| CR2-TS-001 | easy | fix | type safety: `T` vs `T \| undefined` | `first` | fix |
| CR2-TS-002 | medium | fix | optional chaining `?.` + nullish coalescing `??` | `getCity` | fix |
| CR2-TS-003 | medium | implement | Result discriminated union type | `safeParseInt` | — |
| CR2-TS-004 | hard | trap | discriminated union exhaustiveness (correct code) | `area` | no_bug |
| CR2-TS-005 | adversarial | security | prototype pollution via `__proto__` | `merge` | fix |

### 3.4 Java (5 questions, all static mode)

| ID | Difficulty | Type | Bug Category | Function | Verdict |
|----|-----------|------|-------------|----------|---------|
| CR2-JV-001 | easy | fix | integer division truncation `int/int` | `average` | fix |
| CR2-JV-002 | medium | fix | ConcurrentModificationException (fail-fast iterator) | `removeNegatives` | fix |
| CR2-JV-003 | medium | fix | equals/hashCode contract violation | `Money` | fix |
| CR2-JV-004 | hard | fix | race condition: `count++` non-atomic | `Counter` | fix |
| CR2-JV-005 | hard | trap | BigDecimal money accumulation (correct code) | `PriceAccumulator` | no_bug |

### 3.5 Go (4 questions, all static mode)

| ID | Difficulty | Type | Bug Category | Function | Verdict |
|----|-----------|------|-------------|----------|---------|
| CR2-GO-001 | medium | fix | goroutine loop variable capture (Go 1.21) | `main` | fix |
| CR2-GO-002 | medium | fix | slice aliasing (shared backing array) | `CopyPrefix` | fix |
| CR2-GO-003 | hard | fix | unbuffered channel deadlock | `main` | fix |
| CR2-GO-004 | hard | trap | error wrapping `%w` + errors.Is (correct code) | `Load` | no_bug |

### 3.6 C / C++ (4 questions, all static mode)

| ID | Difficulty | Type | Language | Bug Category | Verdict |
|----|-----------|------|----------|-------------|---------|
| CR2-CC-001 | medium | fix | C | `size_t` unsigned wraparound | fix |
| CR2-CC-002 | medium | fix | C | `strcpy` buffer overflow | fix |
| CR2-CC-003 | hard | fix | C | dangling pointer (stack local returned) | fix |
| CR2-CC-004 | hard | trap | C++ | RAII `unique_ptr` (correct code) | no_bug |

### 3.7 Rust (2 questions, all static mode)

| ID | Difficulty | Type | Bug Category | Verdict |
|----|-----------|------|-------------|---------|
| CR2-RS-001 | hard | fix | borrow checker conflict (immutable + mutable borrow) | fix |
| CR2-RS-002 | hard | trap | `Arc<Mutex>` concurrent counter (correct code) | no_bug |

### 3.8 SQL (3 questions, all static mode)

| ID | Difficulty | Type | Bug Category | Verdict |
|----|-----------|------|-------------|---------|
| CR2-SQ-001 | medium | fix | JOIN fan-out inflating amounts | fix |
| CR2-SQ-002 | medium | fix | `NOT IN` with NULL three-valued logic | fix |
| CR2-SQ-003 | hard | implement | window function Top-N (`DENSE_RANK`) | — |

### 3.9 Other Languages (3 questions, all static mode)

| ID | Language | Difficulty | Type | Bug Category | Verdict |
|----|----------|-----------|------|-------------|---------|
| CR2-PH-001 | PHP | adversarial | security | SQL injection (prepared statements + password hashing) | fix |
| CR2-CS-001 | C# | medium | fix | `double` vs `decimal` currency precision | fix |
| CR2-SH-001 | Bash | medium | fix | variable quoting + `set -e` + `ls` parsing | fix |

---

## 4. Bug Category Taxonomy

| Category | Count | Languages | Description |
|----------|-------|-----------|-------------|
| `off_by_one` | 1 | Python | Boundary offset |
| `mutable_default` | 1 | Python | Mutable default argument |
| `integer_division` | 2 | Python, Java | Integer division truncation |
| `closure_binding` | 1 | Python | Closure late binding |
| `closure_scope` | 1 | JavaScript | var has no block scope |
| `shared_reference` | 2 | Python, JavaScript | Shallow copy shared reference |
| `float_comparison` | 1 | Python | Float precision comparison |
| `exception_handling` | 1 | Python | Exception control flow error |
| `type_coercion` | 1 | JavaScript | Implicit type coercion |
| `index_skip` | 1 | JavaScript | Splice index shift |
| `mutation_side_effect` | 1 | JavaScript | Sort in-place mutation |
| `concurrent_modification` | 1 | Java | Fail-fast iterator |
| `equals_hashcode` | 1 | Java | equals/hashCode contract |
| `race_condition` | 1 | Java | Non-atomic operation |
| `goroutine_capture` | 1 | Go | Loop variable capture |
| `slice_aliasing` | 1 | Go | Slice shared backing array |
| `deadlock` | 1 | Go | Unbuffered channel deadlock |
| `signed_unsigned` | 1 | C | Unsigned type wraparound |
| `buffer_overflow` | 1 | C | Buffer overflow |
| `dangling_pointer` | 1 | C | Dangling pointer |
| `borrow_checker` | 1 | Rust | Borrow rule conflict |
| `join_fanout` | 1 | SQL | JOIN fan-out |
| `null_semantics` | 1 | SQL | NULL three-valued logic |
| `quoting` | 1 | Bash | Variable quoting |
| `float_money` | 1 | C# | Float currency precision |
| `security` | 3 | Python, PHP, JS, TS | SQLi / XSS / Prototype Pollution |
| `correct_code_trap` | 10 | Multi | Correct code trap |
| `implementation` | 5 | Multi | From-scratch implementation |
| `performance` | 1 | Python | Algorithm optimization |

---

## 5. Difficulty Design Principles

| Difficulty | Target | Expected Pass Rate (Strong Model) | Expected Pass Rate (Weak Model) |
|------------|--------|----------------------------------|--------------------------------|
| easy | Common pitfalls, single bug | >90% | >60% |
| medium | Subtle bugs, requires language mechanism understanding | >70% | >30% |
| hard | Complex scenarios / trap questions / performance | >50% | >10% |
| adversarial | Security vulnerabilities / adversarial | >40% | >5% |

---

## 6. Discrimination Verification Results

Verified using `scripts/verify-evaluator.mjs`:

| Scenario | Correct Input Score | Incorrect Input Score | Delta | Result |
|----------|-------------------|---------------------|-------|--------|
| JS fix (sandbox) | 87 | 47 | 40 | PASS |
| Trap question (no_bug) | 99 | 9 | 90 | PASS |
| Python static mode | 76 | — | — | PASS |

**Conclusion:** The grader shows significant discrimination between correct fix vs incorrect fix, and between correct trap identification vs false positive.

---

## 7. Data File Structure

```
data/scenarios/
├── cr2-python.json      # 15 Python questions
├── cr2-js-ts.json       # 14 JavaScript + TypeScript questions
├── cr2-java-go.json     # 9 Java + Go questions
├── cr2-c-rust-sql.json  # 9 C + C++ + Rust + SQL questions
└── cr2-others.json      # 3 PHP + C# + Bash questions
```

### Question JSON Schema

```json
{
  "id": "CR2-XX-000",
  "dimension": "code_repair",
  "category": "bug_category",
  "difficulty": "easy|medium|hard|adversarial",
  "language": "language_name",
  "locale": "zh-CN",
  "status": "valid",
  "tier": "public_dev",
  "promptTemplate": "Full prompt template string",
  "sourceCode": "Original source code",
  "functionName": "Target function name",
  "expectedVerdict": "fix|no_bug",
  "grader": "code_repair_v3",
  "graderVersion": "3.0.0",
  "scoring": { "type": "code_repair" },
  "hiddenTests": [
    {
      "id": "test-id",
      "type": "hidden|boundary|edge_case|regression|security|static",
      "testCode": "Test code string",
      "description": "Test description",
      "expectedOutput": "Expected output string"
    }
  ],
  "requirements": ["keyword1", "keyword2"],
  "tags": ["language", "category", "fix|trap"],
  "scenarioVersion": "1.0.0",
  "scenarioHash": ""
}
```

---

## 8. Import Methods

### 8.1 Script Import

```bash
# Import all 50 questions
node scripts/seed-cr2.mjs

# Clear existing CR2 questions first, then import
node scripts/seed-cr2.mjs --reset
```

### 8.2 API Import

```bash
# Single question upsert
curl -X POST http://localhost:3000/api/scenarios \
  -H 'Content-Type: application/json' \
  -d '{"id":"CR2-PY-001","dimension":"code_repair",...}'

# Pack bulk import (from tar.gz URL)
curl -X POST http://localhost:3000/api/migrate/pack \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:4545/packs/zxbench-pro-cr.tar.gz"}'
```

### 8.3 WebUI Import

Navigate to `http://localhost:3000/scenarios`, click "导入测试包" button, select dimension.
