// Transport diagnostic with a fixed synthetic body. No authentication is sent.
fn main() {
    tauri::async_runtime::block_on(async {
        for direct in [false, true] {
            let mut builder =
                reqwest::Client::builder().timeout(std::time::Duration::from_secs(15));
            if direct {
                builder = builder.no_proxy();
            }
            let response = builder
                .build()
                .unwrap()
                .post("https://api.openai.com/v1/chat/completions")
                .header("User-Agent", "tauri-plugin-http/2.6.0")
                .json(&serde_json::json!({"model":"test", "messages":[{"role":"user","content":"Acceptance 7319"}]}))
                .send()
                .await;
            match response {
                Ok(response) => println!("direct={direct} status={}", response.status()),
                Err(error) => println!("direct={direct} error={error:?}"),
            }
        }
    });
}
