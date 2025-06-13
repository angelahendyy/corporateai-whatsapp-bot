const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'corporate_ai_ammin_2025';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Conversation memory storage (in production, use Redis or database)
const conversationMemory = new Map();

// Insurance keywords for filtering
const INSURANCE_KEYWORDS = [
  'insurance', 'policy', 'premium', 'deductible', 'claim', 'coverage',
  'car', 'vehicle', 'auto', 'accident', 'price', 'cost', 'lebanon',
  'ammin', 'تأمين', 'سيارة', 'حادث', 'سعر', 'امّن', 'لبنان'
];

// Context keywords that indicate continuation of conversation
const CONTEXT_KEYWORDS = [
  'what about', 'how about', 'what place', 'where can', 'where to',
  'which one', 'tell me more', 'continue', 'also', 'and',
  'أين', 'ماذا عن', 'كيف', 'أيضا', 'وأين', 'أخبرني المزيد'
];

// Clean up old conversations (prevent memory leaks)
function cleanupOldConversations() {
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  
  for (const [userId, data] of conversationMemory.entries()) {
    if (now - data.lastActivity > THIRTY_MINUTES) {
      conversationMemory.delete(userId);
    }
  }
}

// Get or create conversation context
function getConversationContext(userId) {
  if (!conversationMemory.has(userId)) {
    conversationMemory.set(userId, {
      messages: [],
      topic: null,
      lastActivity: Date.now(),
      isInsuranceContext: false
    });
  }
  
  const context = conversationMemory.get(userId);
  context.lastActivity = Date.now();
  return context;
}

// Add message to conversation history
function addToConversationHistory(userId, message, isUser = true) {
  const context = getConversationContext(userId);
  context.messages.push({
    role: isUser ? 'user' : 'assistant',
    content: message,
    timestamp: Date.now()
  });
  
  // Keep only last 10 messages to manage memory
  if (context.messages.length > 10) {
    context.messages = context.messages.slice(-10);
  }
}

// Determine if message is contextual (continuing previous conversation)
function isContextualMessage(message) {
  return CONTEXT_KEYWORDS.some(keyword => message.includes(keyword)) ||
         message.length < 30; // Short questions often refer to context
}

// Enhanced insurance relation check with context
function isInsuranceRelated(message, context) {
  // Always allow greetings and polite responses
  const greetings = ['hi', 'hello', 'hey', 'thank', 'thanks', 'okay', 'ok', 'مرحبا', 'أهلا', 'سلام', 'شكرا', 'حسنا'];
  if (greetings.some(greeting => message.includes(greeting))) {
    return true;
  }

  // Check direct insurance keywords
  if (INSURANCE_KEYWORDS.some(keyword => message.includes(keyword))) {
    return true;
  }

  // STRICT RULE: Only allow context if BOTH conditions are met:
  // 1. We're in insurance context AND
  // 2. Message is clearly a follow-up to insurance topic
  if (context && context.isInsuranceContext) {
    // Check if recent messages (last 2) contain insurance topics
    const recentMessages = context.messages.slice(-2);
    const hasRecentInsuranceContext = recentMessages.some(msg => 
      INSURANCE_KEYWORDS.some(keyword => 
        msg.content.toLowerCase().includes(keyword)
      )
    );
    
    // Only allow contextual messages if there's recent insurance context
    // AND the message seems like a continuation (short questions, follow-ups)
    if (hasRecentInsuranceContext && isContextualMessage(message)) {
      // Additional check: message should be insurance-context related
      const contextualInsuranceWords = [
        'where', 'how much', 'which', 'what about', 'price', 'cost',
        'company', 'best', 'cheap', 'expensive', 'recommend',
        'أين', 'كم', 'أي', 'ماذا عن', 'سعر', 'كلفة', 'شركة', 'أفضل', 'رخيص'
      ];
      
      if (contextualInsuranceWords.some(word => message.includes(word))) {
        return true;
      }
    }
  }

  return false;
}

// Webhook verification (required by Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
});

// Main webhook endpoint for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach(async (entry) => {
        const changes = entry.changes?.[0];
        
        if (changes?.field === 'messages') {
          const messages = changes.value?.messages;
          
          if (messages?.[0]) {
            await handleIncomingMessage(messages[0], changes.value);
          }
        }
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle incoming WhatsApp messages
async function handleIncomingMessage(message, messageData) {
  const from = message.from;
  const messageBody = message.text?.body || '';
  const messageBodyLower = messageBody.toLowerCase();
  const messageType = message.type;

  console.log(`Received message from ${from}: ${messageBody}`);

  // Clean up old conversations periodically
  if (Math.random() < 0.1) { // 10% chance
    cleanupOldConversations();
  }

  // Get conversation context
  const context = getConversationContext(from);
  
  // Add user message to history
  addToConversationHistory(from, messageBody, true);

  // Only respond to text messages
  if (messageType !== 'text') {
    const response = "مرحباً! أنا CorporateAI، مساعد أمّن للتأمين. أرسل لي رسالة نصية وسأساعدك! 🤖\n\nHello! I'm CorporateAI, Ammin's insurance assistant. Send me a text message and I'll help you! 🤖";
    await sendWhatsAppMessage(from, response);
    addToConversationHistory(from, response, false);
    return;
  }

  // Check if message is insurance-related (with context)
  if (!isInsuranceRelated(messageBodyLower, context)) {
    const response = "أنا متخصص في مواضيع التأمين في لبنان فقط، خاصة لشركة أمّن للتأمين. هل يمكنك سؤالي عن شيء متعلق بالتأمين؟ 🏥🚗\n\nI'm specialized in Lebanese insurance topics only, particularly for Ammin insurance company. Could you please ask me something related to insurance? 🏥🚗";
    
    await sendWhatsAppMessage(from, response);
    addToConversationHistory(from, response, false);
    
    // Reset insurance context if not insurance related
    context.isInsuranceContext = false;
    return;
  }

  // Mark as insurance context
  context.isInsuranceContext = true;

  // Handle special queries
  if (await handleSpecialQueries(from, messageBodyLower, context)) {
    return;
  }

  // Get AI response with context
  const aiResponse = await getOpenAIResponse(messageBody, context);
  
  if (aiResponse) {
    await sendWhatsAppMessage(from, aiResponse);
    addToConversationHistory(from, aiResponse, false);
  } else {
    const errorResponse = "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.\nSorry, there was an error. Please try again.";
    await sendWhatsAppMessage(from, errorResponse);
    addToConversationHistory(from, errorResponse, false);
  }
}

// Handle special queries (Elias, Ammin info, etc.)
async function handleSpecialQueries(from, message, context) {
  let response = null;

  // Elias Chedid Hanna queries
  if (message.includes('elias') || message.includes('chedid') || message.includes('hanna') || 
      message.includes('الياس') || message.includes('شديد') || message.includes('حنا')) {
    
    const isArabic = /[\u0600-\u06FF]/.test(message);
    response = isArabic ? 
      "الياس شديد حنا هو مؤسس ومالك شركة أمّن للتأمين في لبنان. تحت قيادته، نمت شركة أمّن لتصبح واحدة من أكثر شركات التأمين موثوقية في لبنان 🏆" :
      "Elias Chedid Hanna is the founder and owner of Ammin Insurance Company in Lebanon. Under his leadership, Ammin has grown to become one of the most reliable insurance providers in Lebanon 🏆";
  }

  // Ammin company info
  else if (message.includes('what is ammin') || message.includes('about ammin') || 
           message.includes('ما هي أمين') || message.includes('ما هي امن')) {
    
    response = "🏢 AMMIN is an online platform licensed by the International Insurance Commission (ICC), led by Mr. Elie Hanna and his exceptional team.\n\n✨ We simplify the insurance experience for individuals and businesses in Lebanon, providing:\n• Centralized insurance platform\n• Licensed professional brokers\n• Partnerships with top insurance companies\n• User-friendly mobile app\n\n📱 Download our app: https://play.google.com/store/apps/details?id=com.ammin.ammin";
  }

  if (response) {
    await sendWhatsAppMessage(from, response);
    addToConversationHistory(from, response, false);
    return true;
  }

  return false;
}

// Get response from OpenAI with conversation context
async function getOpenAIResponse(message, context) {
  if (!OPENAI_API_KEY) {
    // Fallback responses when no OpenAI key
    const responses = [
      "مرحباً! أنا CorporateAI مساعد أمّن للتأمين. يمكنني مساعدتك في:\n🚗 تأمين السيارات\n🏥 التأمين الصحي\n💰 أسعار السوق\n\nHello! I'm CorporateAI, Ammin's insurance assistant. I can help you with car insurance, health insurance, and market prices in Lebanon! 😊",
      "أهلاً بك! لدي معلومات شاملة عن التأمين في لبنان وأسعار السيارات. ما الذي تريد معرفته؟\n\nWelcome! I have comprehensive information about insurance in Lebanon and car prices. What would you like to know? 🚗",
      "مرحباً! أمّن هي شركة رائدة في التأمين بلبنان. يمكنني مساعدتك في اختيار أفضل تأمين لاحتياجاتك!\n\nHello! Ammin is a leading insurance company in Lebanon. I can help you choose the best insurance for your needs! 💪"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  try {
    // Prepare conversation history for OpenAI
    const conversationHistory = context.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Add current message if not already in history
    if (!conversationHistory.some(msg => msg.content === message)) {
      conversationHistory.push({ role: "user", content: message });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system", 
            content: `You are CorporateAI, a friendly WhatsApp insurance assistant for Ammin, a Lebanese insurance company owned by Elias Chedid Hanna.

            IMPORTANT CONTEXT BEHAVIOR:
            - Remember the conversation history and context
            - If user asks follow-up questions, refer to previous messages
            - Maintain conversation flow naturally
            - Don't require users to repeat context every message
            - Be helpful with contextual follow-ups like "what about...", "where can I...", "which one..."

            FORMATTING for WhatsApp:
            - Use emojis to make messages friendly 😊🚗🏥💰
            - Keep paragraphs short (2-3 lines max)
            - Use bullet points with • symbol
            - Add line breaks for readability
            - Be conversational and friendly like chatting with a friend
            
            TOPICS you help with:
            1. Insurance in Lebanon (auto, health, property)
            2. Car market prices in Lebanon
            3. Car comparisons and recommendations
            4. Lebanese insurance laws
            5. Ammin's services and benefits
            6. Elias Chedid Hanna (founder)
            7. Follow-up questions about any of the above topics
            
            Support both English and Arabic. Keep responses under 1000 characters when possible.
            Always end with a helpful question or suggestion.`
          },
          ...conversationHistory.slice(-6) // Last 6 messages for context
        ],
        max_tokens: 500,
        temperature: 0.7
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        }
      }
    );
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    return "مرحباً! أنا مساعد أمّن للتأمين. كيف يمكنني مساعدتك اليوم؟\n\nHello! I'm Ammin's insurance assistant. How can I help you today? 😊";
  }
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, message) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'CorporateAI WhatsApp Bot',
    activeConversations: conversationMemory.size
  });
});

// Debug endpoint to view conversation memory (for development)
app.get('/debug/conversations', (req, res) => {
  const conversations = [];
  for (const [userId, data] of conversationMemory.entries()) {
    conversations.push({
      userId: userId,
      messageCount: data.messages.length,
      lastActivity: new Date(data.lastActivity).toISOString(),
      isInsuranceContext: data.isInsuranceContext,
      topic: data.topic
    });
  }
  res.json(conversations);
});

// Start server
app.listen(port, () => {
  console.log(`🤖 CorporateAI WhatsApp Bot server running on port ${port}`);
  console.log(`📱 Webhook URL will be available soon`);
  console.log(`✅ Health check: /health`);
  console.log(`🧠 Conversation memory enabled`);
});

module.exports = app;
