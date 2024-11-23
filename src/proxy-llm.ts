type Env = {
  OPENROUTER_API_KEY: string;
};

type RequestBody = {
  prompt: string; // The user prompt for the model
  model_name: string; // The OpenRouter model string (e.g. "openai/gpt4o")
  stream?: boolean; // Whether to stream the response
  referer?: string; // Optional referer URL for OpenRouter identification (e.g. "https://mysite.com")
  title?: string; // Optional title header for OpenRouter identification (e.g. "Codenames AI")
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Define common headers
    const corsHeaders: HeadersInit = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // Cache preflight response for 1 day
    };

    // Utility function for generating responses
    const createResponse = (
      body: string | null,
      status = 200,
      contentType = 'application/json'
    ) => {
      console.log(
        `Response: status=${status}, contentType=${contentType}, body=${body?.slice(0, 100)}${
          body && body.length > 100 ? '...' : ''
        }`
      );
      return new Response(body, {
        status,
        headers: {
          'Content-Type': contentType,
          ...corsHeaders,
        },
      });
    };

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return createResponse(null, 204); // 204 No Content for OPTIONS
    }

    console.log('Hi');
    console.log('Environment keys available:', Object.keys(env));

    if (request.method !== 'POST') {
      return createResponse(JSON.stringify({ error: 'Only POST requests are allowed' }), 405);
    }

    const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;

    if (!OPENROUTER_API_KEY) {
      return createResponse(JSON.stringify({ error: 'Server error: missing API key' }), 500);
    }

    let requestBody: RequestBody;
    try {
      requestBody = await request.json();
      console.log(
        `Received request for model: ${requestBody.model_name}, streaming: ${!!requestBody.stream}`
      );
    } catch (error) {
      return createResponse(JSON.stringify({ error: 'Invalid JSON in request body' }), 400);
    }

    const { prompt, model_name, stream = false, referer, title } = requestBody;
    if (!prompt || !model_name) {
      return createResponse(
        JSON.stringify({ error: 'Missing "prompt" or "model_name" in request body' }),
        400
      );
    }

    // Build the OpenRouter API request payload
    const apiPayload = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: model_name,
      stream, // Pass the stream flag from the client payload
    };

    try {
      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer || 'https://llm-proxy.abyzov.workers.dev/',
          'X-Title': title || 'LLM Proxy Worker',
        },
        body: JSON.stringify(apiPayload),
      });

      if (!openRouterResponse.ok) {
        const errorText = await openRouterResponse.text();
        console.error(`OpenRouter API error: ${openRouterResponse.status} - ${errorText}`);
        return createResponse(
          JSON.stringify({ error: `Error from OpenRouter: ${errorText}` }),
          openRouterResponse.status
        );
      }

      if (stream) {
        // Handle streaming response
        console.log(`Starting streaming response for model: ${model_name}`);
        const { readable, writable } = new TransformStream();
        openRouterResponse.body?.pipeTo(writable);

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...corsHeaders,
          },
        });
      } else {
        // Handle non-streaming response
        const openRouterData = await openRouterResponse.json();
        console.log(`Completed non-streaming request for model: ${model_name}`);
        return createResponse(JSON.stringify(openRouterData));
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
          ? error
          : 'An unknown error occurred';
      console.error(`Proxy error: ${errorMessage}`);
      return createResponse(
        JSON.stringify({ error: `Error proxying to OpenRouter: ${errorMessage}` }),
        500
      );
    }
  },
};