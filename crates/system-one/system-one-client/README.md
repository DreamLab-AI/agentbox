# system-one-client

An async HTTP client for any **System One** typed-decision endpoint — a hosted
API or a self-hosted, capacity-adapting façade. The wire format is the same for
both, so swapping backend is a change of URL and nothing else.

The protocol types live in
[`system-one-core`](https://crates.io/crates/system-one-core), which this crate
re-exports as `system_one_client::core`.

```toml
[dependencies]
system-one-client = "0.1"
```

```rust,no_run
use std::time::Duration;
use system_one_client::SystemOneClient;
use system_one_client::core::{Question, Request};

// inside an async fn returning Result<(), Box<dyn std::error::Error>>
let client = SystemOneClient::builder("http://systemone:8097")
    .bearer_token(std::env::var("SSO_API_KEY").ok())
    .timeout(Duration::from_secs(5))
    .max_retries(2)
    .build()?;

let request = Request::new("laya-typed-decisions", "please rebuild the container")
    .with_question(
        "route",
        Question::choice(
            "which skill should handle this?",
            [("rebuild", "rebuilds the container image"), ("none", "no skill applies")],
        ),
    );

let response = client.predict(&request).await?;
let (choice, probabilities) = response.answers["route"].as_choice().unwrap();
println!("{choice} at {:.2}", probabilities[choice]);
```

## What it does that a bare POST does not

* **Resolves the endpoint either way.** A base URL may be the origin or the full
  `/v1/systemone` path; both appear in real configuration and both work.
* **Validates locally first.** A choice with one option is refused here rather
  than after a round trip.
* **Retries only what is worth retrying** — `429` and `529`, bounded, with
  exponential backoff and a capped `Retry-After`. A `500` from a typed decision
  is a bug, and retrying it makes one bad request into three.
* **Keeps failures apart.** A fired deadline, a broken connection, an HTTP
  status carrying the protocol's error envelope, and a `200` whose body is not a
  System One response are four different `ClientError` variants, because a
  caller's fail-open policy differs for each.
* **Preserves what it does not model.** `predict` returns the typed response;
  `predict_raw` returns the JSON, so backend-specific metadata is available to
  whoever needs it and invisible to whoever does not.

## Fail-open belongs to the caller

This client never fabricates an answer. When the endpoint cannot be reached it
returns an error and the caller decides what to do. A plausible invented
distribution would be indistinguishable from a real one, which is precisely why
there is none.

## Licence

Apache-2.0.
