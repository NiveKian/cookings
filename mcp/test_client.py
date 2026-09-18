import asyncio
import sys
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


async def run(url: str, calls: list[tuple[str, dict]]):
    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print("TOOLS:", [t.name for t in tools.tools])
            for name, args in calls:
                print(f"\n--- {name}({args}) ---")
                result = await session.call_tool(name, args)
                for block in result.content:
                    print(block.text if hasattr(block, "text") else block)


if __name__ == "__main__":
    url = sys.argv[1]
    calls_json = sys.argv[2]
    calls = [(c["tool"], c.get("args", {})) for c in json.loads(calls_json)]
    asyncio.run(run(url, calls))
