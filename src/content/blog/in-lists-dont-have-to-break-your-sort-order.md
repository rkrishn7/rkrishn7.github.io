---
title: "IN-Lists Don't Have to Break Your Sort Order"
description: "How we eliminated expensive full sorts in our live data engine by splitting IN-list filters into per-value partitions — and updated the cost model to match."
date: 2026-03-21
tags: ["rust", "query-optimization", "datafusion"]
---

At [Massive](https://massive.com), we serve real-time financial market data at high throughput and low latency. Our live execution engine ingests millions of records per second from upstream feeds and serves them to users within milliseconds. The query layer is built on [Apache DataFusion](https://datafusion.apache.org/), which gives us a powerful optimizer — but its optimizations are only as good as the properties our execution plans report.

Recently, I ran into a case where DataFusion couldn't prove that our data was sorted, even though it was — and the fallback was an expensive full `SortExec`. This post walks through the problem, the fix, and the cost model update that tied it all together.

## The Live Execution Model

Our live data is stored in an embedded key-value store (RocksDB) with composite row keys that encode a sort order. A simplified key layout looks something like:

```
+-----------+---+-----------+---+-----------+---+-----------+
|  ticker   | . |  channel  | . | timestamp | . |  seq_num  |
|   (var)   |   |   (var)   |   |  (fixed)  |   |  (fixed)  |
+-----------+---+-----------+---+-----------+---+-----------+
```

The byte delimiters (`.`) between fields allow lexicographic ordering over the composite key to correspond exactly to the logical sort order: `[ticker, channel, timestamp, seq_num]`. Because RocksDB stores data in sorted order, range scans over these keys naturally produce sorted output — no post-hoc sorting required.

This sorted layout also gives us a powerful tool for narrowing reads. RocksDB iterators accept upper and lower bounds, so when a query filters on columns that form a prefix of the sort order, we can translate those filters into tight byte-range bounds on the iterator. Instead of scanning all keys and filtering after the fact, we seek directly to the relevant range — this is what makes reads over large volumes of data fast.

We expose all of this to DataFusion through a custom `ExecutionPlan` — let's call it `RocksExec` — that computes iterator bounds from the query's filters and reports its output ordering to the optimizer. When DataFusion knows the data is already sorted, it can skip inserting a `SortExec` node entirely, or use a `SortPreservingMergeExec` to merge multiple pre-sorted streams instead of re-sorting from scratch.

## The Problem

Things worked well when queries filtered on exact equalities:

```sql
SELECT * FROM live_trades
WHERE ticker = 'ESH6'
  AND channel = 360
ORDER BY timestamp DESC
LIMIT 100
```

Since the query pins `ticker` and `channel` to single values, we report them as constants in the plan's equivalence properties. A constant column can only ever produce one value, so it can't affect row ordering — DataFusion sees this, recognizes `[timestamp, seq_num]` as the effective ordering, and skips the sort entirely.

But what about queries like this?

```sql
SELECT * FROM live_trades
WHERE ticker = 'ESH6'
  AND channel IN (360, 415)
ORDER BY timestamp DESC
LIMIT 100
```

This creates two problems. First, the IN-list breaks our iterator bound narrowing. When `channel` is pinned to a single value, we can construct a tight byte-range bound — but when it's `IN (360, 415)`, the two channel values may not be contiguous in the key space. We can't express "these two disjoint ranges" as a single upper/lower bound pair, so the iterator has to cover a wider range than necessary.

Second, the sort order breaks down. Within `channel = 360`, the data is sorted by `[timestamp, seq_num]`. Same for `channel = 415`. But *across* the two channel values, there's no global timestamp ordering — a record with `channel = 360, timestamp = 200` will appear before `channel = 415, timestamp = 100` in the key space, even though `200 > 100`. DataFusion can't prove the output is sorted by `timestamp`, so it inserts a `SortExec`. While optimizations like Top-K with dynamic filtering mitigate this, it's still fundamentally more expensive than a streaming merge over already-sorted data.

```
+-----------------------------+
|          SortExec           |  <-- full materialization + sort
|     (timestamp DESC)        |
+--------------+--------------+
               |
+--------------+--------------+
|         RocksExec           |  <-- data is "almost" sorted
|   channel IN (360, 415)     |
+-----------------------------+
```

## The Insight

The data *is* sorted — just not globally. It's sorted within each `channel` value. If we could present each channel's data as a separate, independently-sorted stream, DataFusion could merge them with a `SortPreservingMergeExec`: a streaming k-way merge that needs no buffering beyond one row per input stream.

The key realization: **an IN-list on a sort-prefix column can be decomposed into N single-value partitions, each of which preserves the sort order of the remaining columns.**

## The Solution: IN-List Partition Splitting

The fix happens at plan construction time, inside `RocksExec`. When building the execution plan, we detect whether the filter contains an IN-list (or equivalent `OR` chain of equalities) on a sort-prefix column where all preceding columns are already constant (equality-filtered). If so, we split the single `RocksExec` into N partitions — one per IN-list value — each with a narrowed equality filter.

Here's the detection logic (simplified):

```rust
fn detect_in_list_split(
    filters: &[Arc<dyn PhysicalExpr>],
    output_ordering: &[PhysicalSortExpr],
    max_partitions: usize,
) -> Option<InListSplit> {
    let eq_columns = equality_filter_columns(filters);

    for sort_expr in output_ordering {
        let col = sort_expr.expr.as_any().downcast_ref::<Column>()?;

        if eq_columns.contains(col.name()) {
            // This column is constant — skip it and continue
            // down the sort prefix.
            continue;
        }

        // First non-constant column: check for an IN-list
        // or OR-of-equality pattern.
        let values = extract_in_list_values(filters, col)
            .or_else(|| extract_or_eq_values(filters, col))?;

        if values.len() >= 2 && values.len() <= max_partitions {
            return Some(InListSplit {
                column: col.clone(),
                values,
            });
        }

        // No split possible — the sort prefix is broken.
        return None;
    }

    None
}
```

When a split is detected, `RocksExec` reports N output partitions instead of one. Each partition replaces the original IN-list filter with a single equality:

```rust
fn build_partition_filters(
    original_filters: &[Arc<dyn PhysicalExpr>],
    split: &InListSplit,
    partition_value: &ScalarValue,
) -> Vec<Arc<dyn PhysicalExpr>> {
    original_filters
        .iter()
        .map(|f| {
            if is_in_list_on_column(f, &split.column) {
                // Replace IN (360, 415) with = 360 (or = 415)
                Arc::new(BinaryExpr::new(
                    Arc::new(split.column.clone()),
                    Operator::Eq,
                    Arc::new(Literal::new(partition_value.clone())),
                ))
            } else {
                f.clone()
            }
        })
        .collect()
}
```

We also tell DataFusion that the split column is a *constant* within each partition — but with *different values across partitions* — using DataFusion's `ConstExpr` with `AcrossPartitions::Heterogeneous`. This is the precise semantic that allows the optimizer to recognize each partition as independently sorted and apply a `SortPreservingMergeExec`:

```
+---------------------------------+
|    SortPreservingMergeExec      |  <-- streaming merge, no buffering
|       (timestamp DESC)          |
+----------------+----------------+
                 |
         +-------+-------+
         |               |
  +------+------+ +------+------+
  |  RocksExec  | |  RocksExec  |
  |  ch = 360   | |  ch = 415   |
  |  (sorted)   | |  (sorted)   |
  +-------------+ +-------------+
```

Each partition also computes its own iterator bounds for the key-value store, so it only scans the key range relevant to its narrowed equality filter. No wasted I/O.

### Safety Valve

We cap the maximum number of partitions (defaulting to 16) to prevent pathological cases like `channel IN (1, 2, ..., 10000)` from creating thousands of concurrent iterators. Beyond the cap, we fall back to the original single-partition plan and let DataFusion insert a `SortExec` if needed. The feature is also opt-in per table, since not all tables benefit from this pattern.

## Updating the Cost Model

This optimization didn't exist in isolation. Our system has a **view matching** layer — a cost model that decides which physical table to route a query to based on a number of factors — chief among them the query's filter predicates and the table's sort order.

The cost model works by analyzing how many prefix columns of a table's sort order are "satisfied" by the query's filters. A column is considered *constant* if the filter contains an equality predicate on it (e.g., `ticker = 'ESH6'`). The more constant prefix columns, the tighter the key range scan, and the lower the estimated cost.

Before this change, the cost model treated `channel IN (360, 415)` as a generic binary filter — helpful, but not as good as a constant. It didn't know that IN-list partitioning would make each value effectively constant within its partition.

The fix: when a table has IN-list partitioning enabled, the cost model now treats IN-list and OR-of-equality filters as constants — *if* they fall within the partition cap. This correctly reflects the physical reality: after splitting, each partition sees a single value for that column.

```rust
// Inside the cost model's filter classification:
if max_in_list_partitions > 0 {
    if let Some(in_list) = expr.downcast_ref::<InListExpr>() {
        if !in_list.negated()
            && in_list.list().len() <= max_in_list_partitions
        {
            // Treat as constant — partitioning makes it so.
            constant_columns.insert(column.name().to_string());
            continue;
        }
    }

    if let Some((col, branch_count)) = count_or_eq_branches(expr) {
        if branch_count <= max_in_list_partitions {
            constant_columns.insert(col.name().to_string());
            continue;
        }
    }
}
```

Without this update, the cost model would undervalue tables that benefit from IN-list partitioning, potentially routing queries to less optimal physical layouts.

## The Full Picture

Putting it all together, here's the lifecycle of a query that hits this optimization:

```
1. Query arrives:
   WHERE ticker = 'ESH6' AND channel IN (360, 415)
   ORDER BY timestamp DESC LIMIT 100

2. View matching (cost model):
   → Recognizes ticker as constant prefix column
   → Recognizes channel as constant (IN-list partitioning aware)
   → Routes to table with sort order [ticker, channel, timestamp, seq]

3. Plan construction (RocksExec):
   → Detects IN-list on channel (sort prefix, predecessors constant)
   → Splits into 2 partitions: channel=360, channel=415
   → Each partition reports ordering: [timestamp DESC, seq DESC]

4. DataFusion optimization:
   → Sees 2 sorted partitions
   → Inserts SortPreservingMergeExec instead of SortExec
   → Pushes LIMIT into the merge

5. Execution:
   → Each partition scans its narrowed key range in RocksDB
   → Streaming merge produces globally sorted output
   → Stops after 100 rows — minimal I/O, no buffering
```

## Takeaways

A few things I found interesting about this work:

**The optimizer only knows what you tell it.** DataFusion is remarkably capable, but its optimizations are gated on the properties your `ExecutionPlan` reports. If your custom plan doesn't accurately describe its ordering, partitioning, and equivalence properties, you leave performance on the table. The fix here wasn't a new algorithm — it was giving the optimizer the information it needed to apply an optimization it already had.

**Cost models need to mirror physical reality.** The partition splitting would have been useless if the cost model didn't route queries to tables that supported it. Keeping the cost model in sync with the execution layer's capabilities is just as important as the optimization itself.

**Small changes, big impact.** The core detection logic is ~40 lines of code. The partition filter rewriting is another ~20. But the downstream effect — eliminating a full sort on potentially millions of rows — is significant. Sometimes the highest-leverage work is at the boundary between your system and the framework it sits on.
