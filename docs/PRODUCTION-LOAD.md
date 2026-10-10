# Local production workload verification

Run `node scripts/build-independent.mjs` first, then:

```sh
YR_LOAD_OUTPUT=/absolute/path/production-load.json node tests/production-load.mjs
```

The test starts the built independent release on an ephemeral loopback TCP port with its own temporary private SQLite database and object directory. It does not connect to the deployed domain, use real customer records, or send email. Temporary files are deleted after the run.

Defaults are 30 representatives split between two territories, 600 factories, 24,000 historical visits, and a 60-second measured workload. Each representative runs an independent cycle, paced to a minimum of two seconds: GPS submission every cycle, CRM read every third cycle, a real visit save every fifth cycle, GPS replay every tenth cycle, and a repeat of every saved visit. Operations within each representative's cycle are sequential, as on one mobile client; representatives run concurrently.

Optional environment variables:

| Variable | Default | Accepted range |
| --- | ---: | --- |
| `YR_LOAD_USERS` | 30 | 2–200 |
| `YR_LOAD_HISTORY` | 24000 | 0–500000 |
| `YR_LOAD_SECONDS` | 60 | 1–3600 |
| `YR_LOAD_INTERVAL_MS` | 2000 | 0–60000 |
| `YR_LOAD_OUTPUT` | stdout only | Absolute output JSON path |

The report records per-operation request counts, status codes, response bytes, observed p50/p95/p99/max latency, completed throughput, cycles per user, build hash, runtime environment, and sampled server memory where available. The run fails on HTTP or assertion errors. Fixture setup, tracker startup, deliberate authorization denial, and final verification reads are outside measured latency counts.

Verification includes region filtering for factories, author filtering for visits, native GPS response identity, rejection of a forged cross-member GPS write, exact persistence of all acknowledged GPS samples and saved visits, absence of duplicate rows after retries, one visit number and one receipt per saved visit, unchanged historical row count, SQLite integrity, and foreign-key integrity.

This is a reproducible local regression workload, not a capacity promise for Namecheap. It does not test Passenger/LiteSpeed, real mobile networks, phone background collection, disk quota, hosting contention, or OTP delivery. Because it is a paced closed-loop workload, slow responses reduce generated traffic; the latency percentiles do not represent an externally fixed arrival rate. A short run is not proof of long-term stability. Repeat on a separate staging deployment with the intended production hosting resources before setting operational capacity targets.

## HTTP client correction during verification

The first tuned-build run is retained as `production-load-tuned-transport.json`. It observed two `ECONNRESET` failures on GPS submissions; 855 acknowledged samples were stored and the two unacknowledged submissions were not stored. The harness correctly failed and did not silently retry or count those submissions as successful.

Investigation of the local Node 24.19 HTTP Agent found that a custom keep-alive Agent without an explicit timeout leaves free sockets with a zero idle timeout, so it does not apply the server's shorter Keep-Alive hint. An independent local HTTP check confirmed active/free socket timeout values of 30000/0 ms before, and 30000/4000 ms with `Agent({timeout:5000})` and the server's `timeout=5` hint. This configuration permits a stale pooled-connection reuse race. A short instrumented repeat did not reproduce the intermittent reset.

The final harness sets the Agent timeout to 5000 ms, retaining the same shared connection pool, 30-second active-request timeout, traffic mix and strict write-verification rules. It records reused-socket/idle-age diagnostics on transport failures and performs **no automatic transport retries**. This corrects test-client connection management; no application code was changed for this issue. The final measured run uses this corrected harness, so comparisons below also reflect that explicit client configuration change.

## Recorded result — 2026-10-01

Final workload started at `2026-10-01T08:24:15.611Z` and finished at `2026-10-01T08:25:17.605Z`. The 60-second request-admission window completed in 61.99 seconds including completion/pacing of the last cycles. Setup and final integrity reads are outside measured operation counts.

| Operation | Baseline p95 (ms) | First hardening p95 (ms) | Final p95 (ms) | Final p99 (ms) | Final maximum (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| GPS save | 25028.45 | 2830.07 | 922.53 | 1270.22 | 1557.39 |
| CRM read | 6230.72 | 2612.41 | 565.45 | 739.61 | 807.67 |
| Visit save | 7187.35 | 3021.61 | 473.96 | 580.35 | 590.17 |
| GPS replay | 4926.43 | 2093.67 | 467.85 | 571.10 | 571.10 |
| Visit replay | 8304.02 | 3421.38 | 597.95 | 718.56 | 720.30 |

The final run completed **1655 measured HTTP requests**, all with status 200, at 26.7 completed requests/second. All 30 representatives completed 30–31 cycles. No HTTP or transport errors occurred, and there were no automatic transport retries.

The database contained exactly **901 acknowledged GPS rows** and **181 new visits**. GPS rows retained the expected member, day, timestamp and coordinates. Each visit retained its expected author, customer relationship, content, visit number and save receipt. There were 91 GPS replays and 181 visit replays without duplicate records. 331 CRM response checks and 901 GPS identity checks passed; the forged cross-member GPS write was rejected. SQLite integrity and foreign-key checks passed, and all 24,000 seeded history rows remained.

The baseline failed five GPS requests at the 30-second timeout. The first hardening run passed correctness but remained slow; it is retained separately. All four long-run results, including the transport failure, remain available as JSON beside this document. These observations use a shared development machine and a closed-loop test; they should not be extrapolated to hosted production capacity.

Final environment: Node 24.19.0, Linux x64, loopback TCP, SQLite WAL with synchronous FULL. Container quota was 8 CPU cores and 8 GiB memory; sampled server RSS was unavailable and is recorded as null. No real phones, production records or real mail were used. This minute-long verification is not a multi-day soak or a hosted staging test.

Verified built server bundle SHA-256: `3b2d7a7e21c5016062572e20f77cb84ae62bb3b6b2e2528d869be01372bd0938`.
Standalone launcher SHA-256: `861833a02e8e19ae827985f7526ef059c8986e8dce327790553aea7f36a9fca5`.
