import os
from dotenv import load_dotenv

load_dotenv()
from langchain_anthropic import ChatAnthropic

try:
    llm = ChatAnthropic(model="claude-3-5-sonnet-20241022", temperature=0)
    print("Sending request...")
    res = llm.invoke("Test message.")
    print("Success:", res)
except Exception as e:
    import traceback
    print("FAILED EXCEPTION:")
    print(traceback.format_exc())
    print("DETAILS:")
    # print raw response body if available
    if hasattr(e, 'response'):
        print(e.response.text)
