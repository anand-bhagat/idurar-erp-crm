import { useState } from 'react';
import { Modal, Typography, Collapse } from 'antd';
import { GithubOutlined, RightOutlined } from '@ant-design/icons';
import './WelcomeModal.css';

const { Title, Paragraph, Text, Link } = Typography;

const WelcomeModal = ({ open, onClose }) => {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={520}
      className="welcome-modal"
    >
      <div className="welcome-body">
        <Title level={3} className="welcome-headline">
          AI-Powered ERP/CRM Agent
        </Title>
        <Paragraph className="welcome-oneliner">
          A conversational AI agent built on top of{' '}
          <Link href="https://github.com/idurar/idurar-erp-crm" target="_blank">
            IDURAR ERP/CRM
          </Link>
          . I added an AI agent layer with tool-calling that can manage clients, create invoices,
          record payments, look up taxes, and more - all through natural conversation.
        </Paragraph>

        <Paragraph className="welcome-note">
          Database resets every hour - feel free to experiment!
        </Paragraph>
        <Paragraph className="welcome-note-small">
          This demo uses a free-tier LLM API which may occasionally be slow or unavailable due to
          rate limits. If the agent isn&apos;t responding, try again in a minute.
        </Paragraph>

        <Collapse
          ghost
          expandIcon={({ isActive }) => (
            <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: 11 }} />
          )}
          className="welcome-details-collapse"
          items={[
            {
              key: '1',
              label: <Text strong>Technical Details</Text>,
              children: (
                <div className="welcome-details-content">
                  <Text strong>Agent Capabilities</Text>
                  <ul>
                    <li>
                      <strong>Clients:</strong> search, create, update, delete, summary stats
                    </li>
                    <li>
                      <strong>Invoices:</strong> search, create, update, delete, financial summary
                    </li>
                    <li>
                      <strong>Payments:</strong> search, create, update, delete, financial summary
                    </li>
                    <li>
                      <strong>Taxes & Payment Modes:</strong> full CRUD management
                    </li>
                    <li>
                      <strong>Navigation:</strong> route to any page in the app
                    </li>
                  </ul>

                  <Text strong>Tech Stack</Text>
                  <ul>
                    <li>50 tools across 8 categories with tool-calling architecture</li>
                    <li>SSE streaming for real-time responses</li>
                    <li>Provider-agnostic LLM layer (OpenAI, Anthropic, Groq, etc.)</li>
                    <li>Two-stage tool routing for scalable tool selection</li>
                    <li>Guardrails: injection detection, circuit breakers, rate limiting</li>
                  </ul>

                  <Text strong>Architecture</Text>
                  <Paragraph style={{ marginBottom: 0, fontSize: '0.82rem' }}>
                    User message &rarr; Router LLM &rarr; Main LLM with tools &rarr; Tool execution
                    &rarr; Streamed response
                  </Paragraph>
                </div>
              ),
            },
          ]}
        />

        <div className="welcome-github">
          <Link href="https://github.com/anand-bhagat/idurar-erp-crm" target="_blank">
            <GithubOutlined /> View on GitHub
          </Link>
        </div>
      </div>
    </Modal>
  );
};

export default WelcomeModal;
