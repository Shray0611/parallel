import { fetch } from "undici";
import dotenv from "dotenv";

dotenv.config();

async function testParallel() {
  const apiKey = process.env.PARALLEL_API_KEY;
  console.log("Testing Parallel Entity Search...");
  const res = await fetch("https://api.parallel.ai/v1beta/findall/entity-search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      entity_type: "companies",
      objective: "mid-sized pharmaceutical manufacturers in India with 200 to 1000 employees",
      match_limit: 5
    })
  });
  const data = await res.json();
  console.log("Parallel status:", res.status);
  console.log("Parallel entities returned:", data.entities?.length);
  if (data.entities && data.entities.length > 0) {
    console.log("Entity sample:", data.entities[0]);
  } else {
    console.log("Error details:", data);
  }

  // Also test Search API enrichment
  if (data.entities && data.entities.length > 0) {
    const comp = data.entities[0];
    console.log("Testing Parallel Search Enrichment on:", comp.name);
    const searchRes = await fetch("https://api.parallel.ai/v1/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        objective: `learn about ${comp.name} artificial intelligence and documentation initiatives`,
        search_queries: [`${comp.name} digital transformation`, `${comp.name} technology initiatives`],
        mode: "fast",
        max_chars_total: 4000,
        session_id: "test-session-1",
        advanced_settings: {
          location: "in",
          max_results: 3
        }
      })
    });
    const searchData = await searchRes.json();
    console.log("Parallel Search status:", searchRes.status);
    console.log("Parallel Search results count:", searchData.results?.length);
    if (searchData.results?.length > 0) {
      console.log("Search excerpt sample:", searchData.results[0]?.excerpts?.[0]?.slice(0, 100));
    }
  }
}

async function testGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  console.log("Testing Groq models...");
  const models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
  for (const model of models) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a test helper. Return JSON { \"status\": \"ok\", \"model\": \"" + model + "\" }" },
            { role: "user", content: "ping" }
          ],
          response_format: { type: "json_object" }
        })
      });
      const data = await res.json();
      console.log(`Model [${model}] status:`, res.status);
      if (res.ok) {
        console.log(`Model [${model}] SUCCESS:`, data.choices?.[0]?.message?.content);
        return model;
      } else {
        console.log(`Model [${model}] error:`, data.error?.message);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

async function run() {
  await testParallel();
  await testGroq();
  process.exit(0);
}

run();
