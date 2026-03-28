import { Typography, Card, Space, Tag, Divider } from 'antd';
import { GithubOutlined, ApiOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text, Link } = Typography;

const About = () => {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography>
        <Title level={2}>IDURAR ERP/CRM - AI Agent Edition</Title>
        <Paragraph>
          An open-source ERP/CRM with invoicing, payments, and client management - extended with a
          conversational AI agent that can perform real actions through natural language.
        </Paragraph>
        <Paragraph>
          Forked from{' '}
          <Link href="https://github.com/idurar/idurar-erp-crm" target="_blank">
            IDURAR
          </Link>{' '}
          and extended with a full AI agent layer by{' '}
          <Link href="https://github.com/anand-bhagat" target="_blank">
            Anand Bhagat
          </Link>
          .
        </Paragraph>

        <Divider />

        <Title level={4}>
          <RobotOutlined /> AI Agent
        </Title>
        <Paragraph>
          The agent uses a tool-calling architecture with 50 tools across 8 categories. It can
          manage clients, create invoices, record payments, look up taxes, and navigate to any page -
          all through natural conversation using the chat widget in the bottom-right corner.
        </Paragraph>

        <Space size={[4, 8]} wrap style={{ marginBottom: 16 }}>
          <Tag>Clients</Tag>
          <Tag>Invoices</Tag>
          <Tag>Payments</Tag>
          <Tag>Payment Modes</Tag>
          <Tag>Taxes</Tag>
          <Tag>Settings</Tag>
          <Tag>Admin Profile</Tag>
          <Tag>Navigation</Tag>
        </Space>

        <Title level={4}>
          <ThunderboltOutlined /> Key Features
        </Title>
        <ul>
          <li>SSE streaming with real-time status indicators</li>
          <li>Multi-tool chaining in a single turn</li>
          <li>Destructive action confirmation flow</li>
          <li>Provider-agnostic LLM layer (OpenAI, Anthropic, Groq, DeepInfra, Ollama)</li>
          <li>Two-stage tool routing for scalable tool selection</li>
          <li>Guardrails: input sanitization, injection detection, circuit breakers</li>
          <li>Structured observability with trace IDs and cost tracking</li>
        </ul>

        <Title level={4}>
          <ApiOutlined /> Tech Stack
        </Title>
        <Card size="small" style={{ marginBottom: 24 }}>
          <Space direction="vertical" size={2}>
            <Text>
              <strong>Frontend:</strong> React, Ant Design, Redux, React Router
            </Text>
            <Text>
              <strong>Backend:</strong> Node.js, Express, MongoDB, Mongoose
            </Text>
            <Text>
              <strong>AI Layer:</strong> OpenAI-compatible + Anthropic adapters, SSE streaming
            </Text>
            <Text>
              <strong>Testing:</strong> Jest (745 tests across 23 suites)
            </Text>
            <Text>
              <strong>Infrastructure:</strong> Docker, node-cron (hourly DB reset), JWT auth
            </Text>
          </Space>
        </Card>

        <div style={{ textAlign: 'center' }}>
          <Space size="large">
            <Link href="https://github.com/anand-bhagat/idurar-erp-crm" target="_blank">
              <GithubOutlined /> View on GitHub
            </Link>
            <Link href="https://github.com/idurar/idurar-erp-crm" target="_blank">
              Original IDURAR
            </Link>
          </Space>
        </div>
      </Typography>
    </div>
  );
};

export default About;
