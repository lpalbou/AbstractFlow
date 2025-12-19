# AbstractFlow

**Diagram-Based AI Workflow Generation**

> **WIP** - Core workflow engine and visual editor are implemented and ready for use!

AbstractFlow is an innovative Python library that enables visual, diagram-based creation and execution of AI workflows. Built on top of [AbstractCore](https://github.com/lpalbou/AbstractCore), it provides an intuitive interface for designing complex AI pipelines through interactive diagrams.

## 🎯 Vision

AbstractFlow aims to democratize AI workflow creation by providing:

- **Visual Workflow Design**: Create AI workflows using intuitive drag-and-drop diagrams
- **Multi-Provider Support**: Leverage any LLM provider through AbstractCore's unified interface
- **Real-time Execution**: Watch your workflows execute in real-time with live feedback
- **Collaborative Development**: Share and collaborate on workflow designs
- **Production Ready**: Deploy workflows to production with built-in monitoring and scaling

## 🚀 Planned Features

### Core Capabilities
- **Diagram Editor**: Web-based visual editor for workflow creation
- **Node Library**: Pre-built nodes for common AI operations (text generation, analysis, transformation)
- **Custom Nodes**: Create custom nodes with your own logic and AI models
- **Flow Control**: Conditional branching, loops, and parallel execution
- **Data Transformation**: Built-in data processing and transformation capabilities

### AI Integration
- **Universal LLM Support**: Works with OpenAI, Anthropic, Ollama, and all AbstractCore providers
- **Tool Calling**: Seamless integration with external APIs and services
- **Structured Output**: Type-safe data flow between workflow nodes
- **Streaming Support**: Real-time processing for interactive applications

### Deployment & Monitoring
- **Cloud Deployment**: One-click deployment to major cloud platforms
- **Monitoring Dashboard**: Real-time workflow execution monitoring
- **Version Control**: Git-based workflow versioning and collaboration
- **API Generation**: Automatic REST API generation from workflows

## 🏗️ Architecture

AbstractFlow is built on a robust foundation:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Diagram UI    │    │  Workflow Engine │    │   AbstractCore  │
│                 │────│                 │────│                 │
│ Visual Editor   │    │ Execution Logic │    │ LLM Providers   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

- **Frontend**: React-based diagram editor with real-time collaboration
- **Backend**: Python workflow execution engine with FastAPI
- **AI Layer**: AbstractCore for unified LLM provider access
- **Storage**: Workflow definitions, execution history, and metadata

## 🎨 Use Cases

### Business Process Automation
- Customer support ticket routing and response generation
- Document analysis and summarization pipelines
- Content creation and review workflows

### Data Processing
- Multi-step data analysis with AI insights
- Automated report generation from raw data
- Real-time data enrichment and validation

### Creative Workflows
- Multi-stage content creation (research → draft → review → publish)
- Interactive storytelling and narrative generation
- Collaborative writing and editing processes

### Research & Development
- Hypothesis generation and testing workflows
- Literature review and synthesis automation
- Experimental design and analysis pipelines

## 🛠️ Technology Stack

- **Core**: Python 3.8+ with AsyncIO support
- **AI Integration**: [AbstractCore](https://github.com/lpalbou/AbstractCore) for LLM provider abstraction
- **Web Framework**: FastAPI for high-performance API server
- **Frontend**: React with TypeScript for the diagram editor
- **Database**: PostgreSQL for workflow storage, Redis for caching
- **Deployment**: Docker containers with Kubernetes support

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/lpalbou/AbstractFlow.git
cd AbstractFlow

# Install core dependencies
pip install -e .

# Or install with web editor dependencies
pip install -e .[web]

# Development installation (includes tests)
pip install -e .[dev]
```

### Dependencies

AbstractFlow requires:
- Python 3.8+
- [AbstractRuntime](https://github.com/lpalbou/AbstractRuntime) - Workflow execution engine
- [AbstractCore](https://github.com/lpalbou/AbstractCore) - LLM provider abstraction

For the visual editor:
- Node.js 18+ (for frontend)
- FastAPI, uvicorn, websockets (for backend)

## 🚀 Quick Start

### Programmatic API

```python
from abstractflow import Flow, FlowRunner

# Create a flow
flow = Flow("my-workflow")

# Add function nodes
def double(x):
    return x * 2

def add_ten(x):
    return x + 10

flow.add_node("double", double, input_key="value", output_key="doubled")
flow.add_node("add_ten", add_ten, input_key="doubled", output_key="result")

# Connect nodes
flow.add_edge("double", "add_ten")
flow.set_entry("double")

# Execute the flow
runner = FlowRunner(flow)
result = runner.run({"value": 5})
print(result)  # {"value": 5, "doubled": 10, "result": 20}
```

### With Agents

```python
from abstractflow import Flow, FlowRunner
from abstractagent import Agent

# Create an agent
planner = Agent(
    name="planner",
    model="gpt-4o-mini",
    system_prompt="You are a helpful planning assistant."
)

# Create flow with agent node
flow = Flow("agent-workflow")
flow.add_node("plan", planner, input_key="task", output_key="plan")
flow.set_entry("plan")

# Run
runner = FlowRunner(flow)
result = runner.run({"task": "Plan a weekend trip to Paris"})
print(result["plan"])
```

### Nested Flows (Subflows)

```python
# Create a subflow
inner_flow = Flow("processing")
inner_flow.add_node("step1", lambda x: x.upper())
inner_flow.add_node("step2", lambda x: f"[{x}]")
inner_flow.add_edge("step1", "step2")
inner_flow.set_entry("step1")

# Use subflow in parent flow
outer_flow = Flow("main")
outer_flow.add_node("preprocess", lambda x: x.strip())
outer_flow.add_node("process", inner_flow)  # Subflow as node
outer_flow.add_node("postprocess", lambda x: x + "!")
outer_flow.add_edge("preprocess", "process")
outer_flow.add_edge("process", "postprocess")
outer_flow.set_entry("preprocess")

runner = FlowRunner(outer_flow)
result = runner.run({"input": "  hello  "})
```

## 🖥️ Visual Workflow Editor

AbstractFlow includes a state-of-the-art web-based visual editor inspired by Unreal Engine Blueprints:

### Features
- **Blueprint-Style Nodes**: Drag-and-drop nodes with typed, colored pins
- **Real-time Execution**: Watch workflows execute with live node highlighting via WebSocket
- **Monaco Code Editor**: Write custom Python code directly in nodes
- **Type-Safe Connections**: Pin type validation prevents incompatible connections
- **Export/Import**: Save and load workflows as JSON

### Blueprint-Style Pin Types

| Type | Color | Shape | Description |
|------|-------|-------|-------------|
| **Execution** | White `#FFFFFF` | ▷ Triangle | Flow control |
| **String** | Magenta `#FF00FF` | ○ Circle | Text data |
| **Number** | Green `#00FF00` | ○ Circle | Integer/Float |
| **Boolean** | Red `#FF0000` | ◇ Diamond | True/False |
| **Object** | Cyan `#00FFFF` | ○ Circle | JSON objects |
| **Array** | Orange `#FF8800` | □ Square | Collections |
| **Agent** | Blue `#4488FF` | ⬡ Hexagon | Agent reference |
| **Any** | Gray `#888888` | ○ Circle | Accepts any type |

### Built-in Node Categories

- **Core**: Agent, Subflow, Python Code
- **Math**: Add, Subtract, Multiply, Divide, Modulo, Power, Abs, Round, Min, Max
- **String**: Concat, Split, Join, Format, Uppercase, Lowercase, Trim, Substring, Length, Replace
- **Control**: If/Else, Compare, NOT, AND, OR
- **Data**: Get Property, Set Property, Merge Objects

### Running the Visual Editor

```bash
# 1. Create virtual environment and install dependencies
cd abstractflow
python3 -m venv .venv
source .venv/bin/activate
pip install -e .  # Install abstractflow
pip install -r web/requirements.txt  # Install FastAPI, uvicorn, websockets

# 2. Start backend server (from abstractflow root)
PYTHONPATH=web:../abstractruntime/src:../abstractcore uvicorn backend.main:app --port 8080 --reload

# 3. In a new terminal, start frontend dev server
cd abstractflow/web/frontend
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

**Production mode** (serve frontend from backend):
```bash
# Build frontend
cd web/frontend && npm run build && cd ../..

# Run backend only (serves frontend from dist/)
PYTHONPATH=web:../abstractruntime/src:../abstractcore uvicorn backend.main:app --port 8080

# Open http://localhost:8080
```

### Project Structure

```
web/
├── backend/                    # FastAPI backend
│   ├── main.py                 # App entry with CORS, static files
│   ├── models.py               # Pydantic models (VisualNode, VisualEdge, VisualFlow)
│   ├── routes/
│   │   ├── flows.py            # Flow CRUD endpoints
│   │   └── ws.py               # WebSocket for real-time execution
│   └── services/
│       ├── executor.py         # VisualFlow → AbstractFlow conversion
│       ├── builtins.py         # 26 built-in function handlers
│       └── code_executor.py    # Sandboxed Python execution
├── frontend/                   # React + TypeScript frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Canvas.tsx      # React Flow canvas
│   │   │   ├── NodePalette.tsx # Categorized node picker
│   │   │   ├── PropertiesPanel.tsx
│   │   │   ├── Toolbar.tsx     # Run/Save/Export/Import
│   │   │   └── nodes/
│   │   │       ├── BaseNode.tsx    # Blueprint-style node
│   │   │       └── CodeNode.tsx    # Monaco editor node
│   │   ├── hooks/
│   │   │   ├── useFlow.ts      # Zustand state management
│   │   │   └── useWebSocket.ts # Real-time updates
│   │   ├── types/
│   │   │   ├── flow.ts         # TypeScript types, PIN_COLORS
│   │   │   └── nodes.ts        # Node templates
│   │   └── styles/             # Dark theme CSS
│   └── package.json
└── requirements.txt            # Backend Python dependencies
```

## 🎯 Roadmap

### Phase 1: Foundation ✅ Complete
- [x] Core workflow engine (Flow, FlowNode, FlowEdge)
- [x] Basic node types (Agent, Function, Subflow)
- [x] Flow compilation to WorkflowSpec
- [x] FlowRunner execution via Runtime
- [x] State passing between nodes with dot notation

### Phase 2: Visual Editor ✅ Complete
- [x] Web-based diagram editor with React Flow
- [x] Blueprint-style pins with colors and shapes
- [x] 26 built-in function nodes (math, string, control, data)
- [x] Custom Python code nodes with Monaco editor
- [x] Export/Import JSON functionality
- [x] Real-time execution updates via WebSocket

### Phase 3: Advanced Features (Planned)
- [ ] Custom node development SDK
- [ ] Advanced flow control (loops, parallel execution)
- [ ] Monitoring and analytics dashboard
- [ ] Cloud deployment integration

### Phase 4: Enterprise (Planned)
- [ ] Enterprise security features
- [ ] Advanced monitoring and alerting
- [ ] Multi-tenant support
- [ ] Professional services and support

## 🤝 Contributing

We welcome contributions from the community! Once development begins, you'll be able to:

- Report bugs and request features
- Submit pull requests for improvements
- Create and share workflow templates
- Contribute to documentation

## 📄 License

AbstractFlow will be released under the MIT License, ensuring it remains free and open-source for all users.

## 🔗 Related Projects

- **[AbstractCore](https://github.com/lpalbou/AbstractCore)**: The unified LLM interface powering AbstractFlow
- **[AbstractCore Documentation](http://www.abstractcore.ai/)**: Comprehensive guides and API reference

## 📞 Contact

For early access, partnerships, or questions about AbstractFlow:

- **GitHub**: [Issues and Discussions](https://github.com/lpalbou/AbstractFlow) (coming soon)
- **Email**: Contact through AbstractCore channels
- **Website**: [www.abstractflow.ai](http://www.abstractflow.ai) (coming soon)

---

**AbstractFlow** - Visualize, Create, Execute. The future of AI workflow development is here.

> Built with ❤️ on top of [AbstractCore](https://github.com/lpalbou/AbstractCore)


