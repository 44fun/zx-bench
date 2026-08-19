# lm-evaluation-harness 源码学习文档

> 目的：用你已经在自己 TS 评测项目里踩过的概念，读懂 EleutherAI 的 lm-evaluation-harness 四个核心文件，为转 Python / 大模型评测岗做准备。行号基于当前 main 分支。

---

## 0. 先建立整体框架（最重要）

一次评测在 lm-eval-harness 里的完整链路：

~~~
任务定义(YAML) → Task 对象 → build_all_requests → 一堆 Instance(请求) → LM 模型执行 → process_results 打分 → aggregation 汇总
~~~

四个文件的职责：

| 文件 | 职责 | 一句话 |
|---|---|---|
| lm_eval/api/task.py | 定义「题长什么样 + 怎么打分」 | 评测的核心契约 |
| lm_eval/tasks/gsm8k/gsm8k.yaml | 用配置声明一个具体任务 | 数据 + prompt + 打分规则 |
| lm_eval/models/huggingface.py | 把模型包成统一接口 | 模型怎么被调用 |
| lm_eval/evaluator.py | 把所有东西串起来的主循环 | 评测流水线 |

先记住这个数据流，下面每个文件都是这条链的一环：

1. Task 把每道题变成若干个 Instance（每个 Instance = 一次对模型的调用请求，带 request_type 和 arguments）。
2. 所有 Instance 按 request_type 分桶，统一交给 LM 去执行。
3. 拿到模型输出后，交回 process_results 算单题分。
4. 最后 aggregation 把单题分汇总成最终指标（通常是 mean）。

---

## 1. lm_eval/api/task.py —— 任务抽象（最核心）

### 1.1 抽象基类 Task（第 64 行）

一个任务 = 一个 benchmark 的完整定义。它把「一道题」抽象成一个 doc（通常是个 dict，如 {question, answer}）。

必须实现的 6 个核心方法，这就是评测的「最小契约」：

| 方法 | 作用 | 你的项目里对应 |
|---|---|---|
| doc_to_text(doc) | 把一道题转成喂给模型的 prompt（问题部分） | prompt 构建 / resolveUserPrompt |
| doc_to_target(doc) | 标准答案（用于算分 / few-shot） | expectedAnswer |
| construct_requests(doc, ctx) | 决定这一题要发几个请求、每个请求的类型和参数 | orchestrator 决定调几次模型 |
| process_results(doc, results) | 拿模型输出算单题指标 | 确定性评分器 totalScore |
| aggregation() | 把单题指标汇总成最终分（通常 mean） | computeWeightedTotal |
| higher_is_better() | 每个指标是不是越高越好 | 分数语义的一部分 |

抽象方法定义（第 381–431 行）：

~~~python
@abc.abstractmethod
def construct_requests(self, doc, ctx, **kwargs):
    """构造要发给 LM 的请求，返回 Instance 列表"""

@abc.abstractmethod
def process_results(self, doc, results):
    """单道题 + 模型结果 -> 该题的指标 dict，如 {'exact_match': 1.0}"""

@abc.abstractmethod
def aggregation(self):
    """返回 {指标名: 聚合函数}，如 {'exact_match': mean}"""

@abc.abstractmethod
def higher_is_better(self):
    """返回 {指标名: bool}"""
~~~

关键心智模型：construct_requests 和 process_results 是配对的——前者定义「问模型几个问题、怎么问」，后者定义「拿到回答后怎么算分」。一道题可以发多个请求（比如多选题会对每个选项各算一次概率）。

### 1.2 build_all_requests（第 268 行）—— 把 Task 变成请求列表

~~~python
for doc_id, doc in doc_iterator(...):
    fewshot_ctx = self.fewshot_context(doc, num_fewshot=...)   # 拼 few-shot 上下文
    inst = self.construct_requests(doc=doc, ctx=fewshot_ctx, ...)  # 生成请求
    instances.append(inst)
self._instances = flattened_instances   # 存进 task.instances
~~~

要点：先拼上下文（含 few-shot 示例），再对「这一题」构造请求。结果存在 task.instances，供 evaluator 取用。

### 1.3 ConfigurableTask（第 618 行）—— 现代任务都用 YAML 驱动

现在几乎没人手写 Task 类了，都用 YAML + 这个 ConfigurableTask。它把 YAML 里的字符串模板渲染成实际 prompt。

doc_to_text 的渲染逻辑（第 1200 行）——这是理解 YAML 模板的关键：

~~~python
def doc_to_text(self, doc, doc_to_text=None):
    doc_to_text = self.config.doc_to_text   # 来自 YAML，如 "Question: {{question}}\nAnswer:"
    if isinstance(doc_to_text, str):
        if doc_to_text in self.features:      # 若字符串正好是数据集某列名
            return doc[doc_to_text]
        else:
            return utils.apply_template(doc_to_text, doc)   # 否则用 {{列名}} 渲染
~~~

所以 YAML 里的 doc_to_text: "Question: {{question}}\nAnswer:" 会被渲染成：

~~~
Question: <这题的问题文本>
Answer:
~~~

{{question}} 就是数据集的一列，用 Jinja2 风格模板填充。

### 1.4 四种 output_type（construct_requests，第 1362 行）

这是决定「模型以什么方式被问」的分叉：

| output_type | 请求类型 | 用途 | 例子 |
|---|---|---|---|
| loglikelihood | 算「续写这段文本的对数概率」 | 选择题/续写题（用概率比大小） | hellaswag、MMLU |
| multiple_choice | 对每个选项各发一个 loglikelihood | 多选题（自动展开） | hellaswag |
| generate_until | 自由生成直到停词 | 开放答案 | gsm8k、HumanEval |
| loglikelihood_rolling | 整段文本的逐 token 概率 | 困惑度 PPL | wikitext |

对应代码（第 1370–1408 行）：

~~~python
if self.OUTPUT_TYPE == "loglikelihood":
    arguments = (ctx, self.doc_to_target(doc))          # (上下文, 期望续写)
elif self.OUTPUT_TYPE == "multiple_choice":
    choices = self.doc_to_choice(doc)
    arguments = [(ctx, f" {cont}") for cont in choices]  # 每个选项一个请求
elif self.OUTPUT_TYPE == "generate_until":
    arguments = (ctx, deepcopy(self.config.generation_kwargs))
~~~

### 1.5 MultipleChoiceTask（第 1688 行）—— 一个完整的最小例子

这是理解整个打分循环最好的一个类，全文不到 40 行：

~~~python
class MultipleChoiceTask(Task):
    OUTPUT_TYPE = "loglikelihood"

    def construct_requests(self, doc, ctx, **kwargs):
        # 对每个选项构造一个 loglikelihood 请求
        return [
            Instance(request_type="loglikelihood", doc=doc,
                     arguments=(ctx, f" {choice}"), idx=i)
            for i, choice in enumerate(doc["choices"])
        ]

    def process_results(self, doc, results):
        results = [res[0] for res in results]           # 只取对数概率
        gold = doc["gold"]
        acc = 1.0 if np.argmax(results) == gold else 0.0  # 概率最大的选项 == 正确项
        acc_norm = 1.0 if np.argmax(results / len(choices)) == gold else 0.0
        return {"acc": acc, "acc_norm": acc_norm}

    def aggregation(self):
        return {"acc": mean, "acc_norm": mean}

    def higher_is_better(self):
        return {"acc": True, "acc_norm": True}
~~~

这 4 个方法连起来就是评测的全部：问模型（给每个选项算概率）→ 算分（取概率最大者比对正确答案）→ 汇总（mean）→ 语义（越高越好）。你搞懂这个类，就懂了整个 task.py 的骨架。

---

## 2. lm_eval/tasks/gsm8k/gsm8k.yaml —— 一个任务怎么声明 prompt + 打分

（说明：mmlu.yaml 在新版仓库路径已变化，这里用同样经典、且正好对应你「推理数学」维度的 gsm8k 举例；hellaswag 作 multiple_choice 补充。）

完整 YAML（已精简注释）：

~~~yaml
task: gsm8k
dataset_path: openai/gsm8k        # 从 HuggingFace 加载数据集
dataset_name: main
output_type: generate_until       # 自由生成
test_split: test

doc_to_text: "Question: {{question}}\nAnswer:"
doc_to_target: "{{answer}}"

metric_list:
  - metric: exact_match
    aggregation: mean
    higher_is_better: true

generation_kwargs:
  until: ["Question:", "</s>", "<|im_end|>"]   # 生成到这些词就停
  do_sample: false
  temperature: 0.0

num_fewshot: 5

filter_list:
  - name: "flexible-extract"
    filter:
      - function: "regex"
        regex_pattern: "(-?[$0-9.,]{2,})|(-?[0-9]+)"
      - function: "take_first"
~~~

逐段解读（面试必讲）：

1. doc_to_text / doc_to_target：定义 prompt 和标准答案。注意 gsm8k 的答案是「包含推理过程 + #### 数字」的长文本，所以真正的答案是 #### 后面的数字，靠 filter 抽取。

2. output_type: generate_until：因为答案需要自由生成，不是四选一。

3. generation_kwargs.until（停止词）：生成到 Question:（下题的标题）或 </s> 就停——防止模型话痨一路生成下去。这正是你项目「反拖尾」要解决的事。lm-eval 用停词实现，你用 answerFirst + hardTimeLimitMs 实现，是同一个问题的两种解法。

4. filter_list（打分前的答案抽取）：模型生成的是一整段话，得先用正则把「最终答案」抠出来再比对。gsm8k 用 #### 数字 或「最后一个数字」来抽取。这对应你项目的答案提取 / formatBlindspot——都是「格式不规范但内容对」的兜底处理。

5. metric_list：exact_match（完全匹配）+ aggregation: mean（取平均）+ higher_is_better: true。

hellaswag（multiple_choice）对比，注意它多了一个 doc_to_choice：

~~~yaml
task: hellaswag
output_type: multiple_choice
doc_to_text: "{{query}}"
doc_to_target: "{{label}}"
doc_to_choice: "choices"          # 选项列
metric_list:
  - metric: acc
    aggregation: mean
    higher_is_better: true
  - metric: acc_norm               # 按选项长度归一化后的准确率
    aggregation: mean
    higher_is_better: true
~~~

一句话总结：YAML 就是声明「数据从哪来、prompt 怎么拼、答案怎么抽、用什么指标汇总」——全部是配置，不写代码。这是 lm-eval-harness 相比你项目（打分逻辑全在 TS 代码里）最大的工程化差异。

---

## 3. lm_eval/models/huggingface.py —— 模型怎么被调用

### 3.1 HFLM 类（第 60 行）：把 HuggingFace 模型包成统一接口

HFLM 继承 TemplateLM，负责：加载 tokenizer + 模型、做前向、做生成，把结果返回成标准格式。你项目里 callModel 干的事，它这里干，只是它要兼容很多种模型。

### 3.2 三种请求类型对应三种方法

| 方法 | 干什么 | 数学含义 |
|---|---|---|
| loglikelihood | 给定上下文，算「续写文本」的对数概率 | P(续写 | 上下文)，用于选择题 |
| generate_until | 自由生成直到停词 | 生成开放答案 |
| loglikelihood_rolling | 整段文本逐 token 的 perplexity | 语言建模困惑度 |

### 3.3 底层两块：_model_call 和 _model_generate

_model_call（第 1114 行）——纯前向，拿 logits：

~~~python
with torch.no_grad(), torch.autocast(...):   # 不计算梯度 + 混合精度
    return self.model(inps).logits            # 返回 [batch, seq, vocab]
~~~

_model_generate（第 1156 行）——生成，带停止条件：

~~~python
# temperature=0 且没开 do_sample -> 退化为贪心解码
if temperature == 0.0 and do_sample is None:
    generation_kwargs["do_sample"] = False
# 把 stop 词转成 stopping_criteria
stopping_criteria = stop_sequences_criteria(self.tokenizer, stop, ...)
return self.model.generate(input_ids=context, max_length=max_length,
                           stopping_criteria=stopping_criteria, ...)
~~~

关键点：
- loglikelihood 的核心循环其实在 TemplateLM（lm_eval/api/model.py），huggingface.py 只提供 _model_call（拿 logits）。它把「上下文+续写」拼一起前向，再只对「续写」那一段 token 的对数概率求和。
- generate_until（第 1577 行）里有个细节：按生成参数分组、按长度排序后成批（Collator），这样同一批里的请求生成参数一致、长度相近，省显存、避免 OOM。

### 3.4 对应你的项目

| lm-eval | 你的项目 |
|---|---|
| HFLM._model_call | callModel 里调 OpenAI 兼容接口拿输出 |
| _model_generate 的 stop 停词 | 你的反拖尾 answerFirst / 停词 |
| loglikelihood（概率比大小） | 你没有直接对应物——你是「生成+打分」，它是「算概率」 |
| generate_until | 你的正常生成路径 |

---

## 4. lm_eval/evaluator.py —— 评测主循环

evaluate()（第 429 行）是整个框架的总调度。完整流程：

~~~
1. 对每个 task，调用 task.build_all_requests() → 产出 task.instances
2. 把所有 instance 按 request_type 分桶（loglikelihood / generate_until / ...）
3. 逐桶调用 lm 的对应方法：getattr(lm, reqtype)(cloned_reqs)
4. 把模型输出写回 req.resps
5. 后处理：task.apply_filters() → 对每个 doc 调 task.process_results() → 累积单题指标
6. _process_results() → task.aggregation() 汇总 + bootstrap 算 stderr
~~~

关键代码：

步骤 1（构建请求，第 541 行）：
~~~python
task.build_all_requests(limit=limit, rank=lm.rank, world_size=lm.world_size, ...)
~~~

步骤 2-3（分桶 + 执行，第 588–600 行）：
~~~python
for reqtype, reqs in requests.items():
    cloned_reqs = [req] * req.repeats            # 每个请求重复 K 次（多数投票用）
    resps = getattr(lm, reqtype)(cloned_reqs)    # 调 lm.loglikelihood / lm.generate_until
    for x, req in zip(resps, cloned_reqs):
        req.resps.append(x)                       # 结果写回请求对象
~~~

步骤 5（算分，第 636–669 行）：
~~~python
for doc_id, doc in doc_iterator:
    requests = instances_by_doc_id[doc_id]
    metrics = task.process_results(doc, [req.filtered_resps[filter_key] for req in requests])
    for metric, value in metrics.items():
        acc["raw_metrics"][(metric, filter_key)].append(value)
~~~

步骤 6（汇总 + 置信区间，第 704 行）：
~~~python
res = _process_results(eval_results_acc, groups, bootstrap_iters)
~~~

两个面试高频点：
1. bootstrap_iters（默认 100000）：用 bootstrap 重采样算指标的标准误 stderr——这就是我上次跟你说「你的分数缺方差/置信区间」时，lm-eval 已经内置的东西。面试官问「你的分数可信吗」，lm-eval 的答案是「给你算 stderr」。
2. repeats + 多数投票：同一题可重复生成 K 次取多数，应对采样随机性。

### 对应你的项目

| lm-eval evaluate() | 你的项目 |
|---|---|
| build_all_requests | orchestrator 生成待测题目清单 |
| 按 request_type 分桶 + getattr(lm, reqtype) | orchestrator 主循环里对每道题调 callModel |
| process_results | evaluators/*.ts 的确定性评分 |
| aggregation + bootstrap stderr | 你的 computeWeightedTotal（但你没有 stderr） |
| repeats 多数投票 | 你 config 里的 runsPerQuestion |

---

## 5. 学习路线（按性价比排序）

1. 精读 MultipleChoiceTask（task.py 1688 行）——40 行看完整个「问→算→汇总」闭环，性价比最高。
2. 精读 gsm8k.yaml——理解「声明式定义任务」，这是你项目没有的新范式。
3. 读 ConfigurableTask.construct_requests 的 4 个 output_type（1362 行）——理解「模型以几种方式被问」。
4. 读 evaluate() 主循环（evaluator.py 429 行）——把零散概念串起来。
5. huggingface.py 的 _model_call / _model_generate——需要真正上手跑模型时再看细节。

## 6. 面试能直接聊的点（结合你的项目）

- 「我懂评测的双轨」：lm-eval 用 loglikelihood（选择题算概率）和 generate_until（生成+抽取答案）两种范式；我项目里用「确定性规则 + AI Judge」。
- 「我懂答案抽取和格式兜底」：gsm8k 用 filter 正则抽 #### 数字；我项目做了 formatBlindspot（区分「格式没答对」和「能力不行」）——这比 lm-eval 默认更进一层。
- 「我懂分数可比性」：lm-eval 用 aggregation: mean + bootstrap stderr；我项目用「难度加权 + 维度加权综合分」——两者解决的是同一个问题（裸平均分不可比）。
- 「我懂生成控制」：lm-eval 用 until 停词；我项目做了反拖尾 answerFirst + hardTimeLimitMs。
- 「我懂评测的坑」：decontamination（去污染）、few-shot 敏感性、repeats 多数投票、acc_norm（按选项长度归一化）——这些在 task.py / evaluator.py 里都能找到对应代码。

## 7. 附：你项目 ↔ lm-eval-harness 概念对照总表

| 概念 | 你的项目 (TS) | lm-eval-harness (Python) |
|---|---|---|
| 题目抽象 | ScenarioDefinition | Task 的 doc |
| prompt 构建 | resolveUserPrompt / buildMessages | doc_to_text + fewshot_context |
| 标准答案 | expectedAnswer | doc_to_target |
| 决定调模型几次/怎么调 | orchestrator 分支 | construct_requests + output_type |
| 模型调用 | callModel | HFLM.loglikelihood / generate_until |
| 单题打分 | evaluators/*.ts 的 totalScore | process_results |
| 答案抽取/格式兜底 | formatBlindspot / extractJson | filter_list (regex) |
| 汇总 | computeWeightedTotal | aggregation (mean) |
| 生成停止 | answerFirst / hardTimeLimitMs | generation_kwargs.until |
| 主循环 | orchestrator 主循环 | evaluate() |
| 置信区间 | （缺失，待补） | bootstrap_iters → stderr |