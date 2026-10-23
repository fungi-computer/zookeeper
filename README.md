# Zookeeper

Zookeeper governs one Durable Object's store. Storage and memory limits for
Durable Objects belong here, never in Shiitake core.

Zookeeper is an installable package candidate because Oyster's public Shiitake
host uses its pressure check and patrol at runtime. Its stranger fixture checks
the packed exports without workspace links. This packaging boundary does not
authorize an external repository, registry publication, or deployment.

`openStoragePressure({ usedBytes, budgetBytes })` returns the host's
`StoragePressureCheck` for Shiitake's `storagePressure` option. It reports
pressure at 80% of the budget and keeps reporting it until usage falls below
75%, so admission does not flap at the threshold. Shiitake keeps the refusal
door and the typed `storage_pressure` error; Zookeeper owns the numbers.

An invalid budget throws a `contract`/`invalid` `ShiitakeError` when opened. An
unreadable measurement throws a `store`/`unavailable` `ShiitakeError`, which
refuses the new work.

Zookeeper is Shiitake-only. Pi Durable hosts are out of scope.

`openPatrol({ budget, readColdSessions, report })` returns host work for
Shiitake's `hostWork`. Its synchronous `pending` reads only the platform's size
of the store: `nextWakeAt` is `null` while the store is under the waterline
(half the budget) and a time at least a second ahead (five minutes by default)
while it is over. Its `run` is one bounded pass: when the store is over the
waterline it reads one page of Sessions, skips a Session whose bytes are unknown
or whose row cannot be read, and hands the host a typed `PatrolReport`. It
evicts nothing.

`zookeeperCompaction({ writer })` is the compaction handoff extension over a
host-bound `ArchiveWriter`; the host appends it and `zookeeperCompactionGrant`
to its roster. It archives what leaves the model context (the history and
turn-prefix messages, not the summary), returns the writer's receipt as the
opaque `accepted` receipt, and answers `discarded_by_policy` only when nothing
leaves the context. A writer failure is a handoff failure, so compaction stops
with the prior context intact; it is never a discard.
