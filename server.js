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

// User analytics storage - NEW CODE
const userAnalytics = new Map();

// Track user activity - NEW FUNCTION
function trackUserActivity(userId, message, messageType = 'text') {
  const userKey = userId;
  
  if (!userAnalytics.has(userKey)) {
    userAnalytics.set(userKey, {
      phoneNumber: userId,
      firstContact: new Date().toISOString(),
      totalMessages: 0,
      lastSeen: new Date().toISOString(),
      topics: [],
      recentMessages: []
    });
  }
  
  const userData = userAnalytics.get(userKey);
  userData.totalMessages++;
  userData.lastSeen = new Date().toISOString();
  
  // Track what they're asking about
  if (containsInsuranceKeywords(message)) {
    const topic = extractMainTopic(message);
    if (!userData.topics.includes(topic)) {
      userData.topics.push(topic);
    }
  }
  
  // Store recent messages (keep last 5)
  userData.recentMessages.push({
    time: new Date().toISOString(),
    message: message.substring(0, 50) + '...',
    isInsuranceRelated: containsInsuranceKeywords(message)
  });
  
  if (userData.recentMessages.length > 5) {
    userData.recentMessages = userData.recentMessages.slice(-5);
  }
}

// Extract what topic they're asking about - NEW FUNCTION
function extractMainTopic(message) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('car') || lowerMessage.includes('سيارة')) return 'Car Insurance';
  if (lowerMessage.includes('health') || lowerMessage.includes('صحي')) return 'Health Insurance';
  if (lowerMessage.includes('price') || lowerMessage.includes('سعر')) return 'Pricing';
  if (lowerMessage.includes('claim') || lowerMessage.includes('مطالبة')) return 'Claims';
  if (lowerMessage.includes('elias') || lowerMessage.includes('الياس')) return 'Company Info';
  
  return 'General Insurance';
}

// Insurance keywords for filtering
const INSURANCE_KEYWORDS = [
  'insurance', 'policy', 'premium', 'deductible', 'claim', 'coverage',
  'car', 'vehicle', 'auto', 'accident', 'price', 'cost', 'lebanon',
  'ammin', 'تأمين', 'سيارة', 'حادث', 'سعر', 'امّن', 'لبنان',
  'motor', 'health', 'medical', 'life', 'property', 'home', 'fire',
  'third party', 'comprehensive', 'quote', 'renewal', 'broker'
];

// Contextual follow-up keywords that show continuation
const CONTEXT_KEYWORDS = [
  'what about', 'how about', 'what place', 'where can', 'where to', 'where is',
  'which one', 'which', 'tell me more', 'continue', 'also', 'and', 'or',
  'how much', 'what price', 'cost', 'expensive', 'cheap', 'better', 'best',
  'recommend', 'suggest', 'compare', 'difference', 'vs', 'versus',
  'أين', 'ماذا عن', 'كيف', 'أيضا', 'وأين', 'أخبرني المزيد', 'أي', 'أفضل',
  'كم', 'سعر', 'أرخص', 'أغلى', 'قارن', 'الفرق'
];

// Greetings and polite responses
const GREETINGS = [
  'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening',
  'thank', 'thanks', 'thank you', 'okay', 'ok', 'yes', 'no', 'sure',
  'مرحبا', 'أهلا', 'سلام', 'صباح الخير', 'مساء الخير', 'شكرا', 'نعم', 'لا', 'حسنا'
];

// Clean up old conversations (prevent memory leaks)
function cleanupOldConversations() {
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  
  for (const [userId, data] of conversationMemory.entries()) {
    if (now - data.lastActivity > THIRTY_MINUTES) {
      conversationMemory.delete(userId);
      console.log(`Cleaned up conversation for user: ${userId}`);
    }
  }
}

// Get or create conversation context
function getConversationContext(userId) {
  if (!conversationMemory.has(userId)) {
    console.log(`Creating new conversation context for user: ${userId}`);
    conversationMemory.set(userId, {
      messages: [],
      topic: null,
      lastActivity: Date.now(),
      isInsuranceContext: false,
      lastInsuranceMessage: null
    });
  }
  
  const context = conversationMemory.get(userId);
  context.lastActivity = Date.now();
  return context;
}

// Add message to conversation history
function addToConversationHistory(userId, message, isUser = true) {
  const context = getConversationContext(userId);
  
  const messageEntry = {
    role: isUser ? 'user' : 'assistant',
    content: message,
    timestamp: Date.now()
  };
  
  context.messages.push(messageEntry);
  
  // Keep only last 8 messages to manage memory but maintain context
  if (context.messages.length > 8) {
    context.messages = context.messages.slice(-8);
  }
  
  // Track last insurance-related message for context
  if (isUser && containsInsuranceKeywords(message)) {
    context.lastInsuranceMessage = message;
  }
  
  console.log(`Added to conversation history for ${userId}: ${isUser ? 'User' : 'Bot'} - ${message.substring(0, 50)}...`);
}

// Check if message contains insurance keywords
function containsInsuranceKeywords(message) {
  const lowerMessage = message.toLowerCase();
  return INSURANCE_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

// Determine if message is contextual (continuing previous conversation)
function isContextualMessage(message) {
  const lowerMessage = message.toLowerCase();
  return CONTEXT_KEYWORDS.some(keyword => lowerMessage.includes(keyword)) ||
         message.length < 40; // Short questions often refer to context
}

// Enhanced insurance relation check with context
function isInsuranceRelated(message, context) {
  const lowerMessage = message.toLowerCase();
  
  // Always allow greetings and polite responses
  if (GREETINGS.some(greeting => lowerMessage.includes(greeting))) {
    console.log(`Allowing greeting: ${message}`);
    return true;
  }

  // Check direct insurance keywords
  if (containsInsuranceKeywords(message)) {
    console.log(`Insurance keywords found in: ${message}`);
    return true;
  }

  // Context-based allowance - STRICT rules
  if (context && context.isInsuranceContext) {
    console.log(`Checking contextual message in insurance context: ${message}`);
    
    // Check if recent messages (last 3) contain insurance topics
    const recentMessages = context.messages.slice(-3);
    const hasRecentInsuranceContext = recentMessages.some(msg => 
      containsInsuranceKeywords(msg.content)
    );
    
    console.log(`Recent insurance context: ${hasRecentInsuranceContext}`);
    
    // Allow contextual messages only if:
    // 1. There's recent insurance context AND
    // 2. The message is clearly a follow-up AND
    // 3. The message contains contextual keywords
    if (hasRecentInsuranceContext && isContextualMessage(message)) {
      console.log(`Allowing contextual message: ${message}`);
      return true;
    }
  }

  console.log(`Rejecting non-insurance message: ${message}`);
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
    console.log('Webhook verification failed');
    res.status(403).send('Verification failed');
  }
});

// Main webhook endpoint for receiving messages
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Received webhook:', JSON.stringify(body, null, 2));

    if (body.object === 'whatsapp_business_account') {
      // Process each entry
      for (const entry of body.entry || []) {
        const changes = entry.changes?.[0];
        
        if (changes?.field === 'messages') {
          const messages = changes.value?.messages;
          
          if (messages?.[0]) {
            await handleIncomingMessage(messages[0], changes.value);
          }
        }
      }
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

  console.log(`📥 Received message from ${from}: ${messageBody}`);

  // Clean up old conversations periodically
  if (Math.random() < 0.1) { // 10% chance
    cleanupOldConversations();
  }

  // Get conversation context
  const context = getConversationContext(from);
  
  // Add user message to history FIRST
  addToConversationHistory(from, messageBody, true);
  
  // Track user activity - NEW LINE ADDED
  trackUserActivity(from, messageBody);

  try {
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
      console.log(`Reset insurance context for ${from}`);
      return;
    }

    // Mark as insurance context
    context.isInsuranceContext = true;
    console.log(`Set insurance context for ${from}`);

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

  } catch (error) {
    console.error(`Error handling message from ${from}:`, error);
    const errorResponse = "عذراً، حدث خطأ تقني. يرجى المحاولة مرة أخرى.\nSorry, there was a technical error. Please try again.";
    await sendWhatsAppMessage(from, errorResponse);
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
    console.log(`Sending special query response to ${from}`);
    await sendWhatsAppMessage(from, response);
    addToConversationHistory(from, response, false);
    return true;
  }

  return false;
}

// Get response from OpenAI with conversation context
async function getOpenAIResponse(message, context) {
  if (!OPENAI_API_KEY) {
    console.log('No OpenAI key, using fallback responses');
    // Enhanced fallback responses when no OpenAI key
    const responses = [
      "مرحباً! أنا CorporateAI مساعد أمّن للتأمين. يمكنني مساعدتك في:\n🚗 تأمين السيارات\n🏥 التأمين الصحي\n💰 أسعار السوق\n\nHello! I'm CorporateAI, Ammin's insurance assistant. I can help you with car insurance, health insurance, and market prices in Lebanon! 😊",
      "أهلاً بك! لدي معلومات شاملة عن التأمين في لبنان وأسعار السيارات. ما الذي تريد معرفته؟\n\nWelcome! I have comprehensive information about insurance in Lebanon and car prices. What would you like to know? 🚗",
      "مرحباً! أمّن هي شركة رائدة في التأمين بلبنان. يمكنني مساعدتك في اختيار أفضل تأمين لاحتياجاتك!\n\nHello! Ammin is a leading insurance company in Lebanon. I can help you choose the best insurance for your needs! 💪"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  try {
    console.log(`Getting OpenAI response for: ${message}`);
    
    // Prepare conversation history for OpenAI - include more context
    const conversationHistory = context.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system", 
            content: `You are CorporateAI, a WhatsApp insurance assistant for Ammin, a Lebanese insurance company owned by Elias Chedid Hanna.

            CRITICAL RULE: You ONLY discuss insurance and car-related topics. If a user asks about anything else (food, animals, general knowledge, etc.), you MUST respond with:
            "أنا متخصص في مواضيع التأمين في لبنان فقط، خاصة لشركة أمّن للتأمين. هل يمكنك سؤالي عن شيء متعلق بالتأمين؟ 🏥🚗

I'm specialized in Lebanese insurance topics only, particularly for Ammin insurance company. Could you please ask me something related to insurance? 🏥🚗"

            NEVER answer questions about:
            - Food, fruits, vegetables (like strawberries)
            - Animals, nature, science
            - General knowledge, entertainment
            - Weather, sports, politics
            - Technology unrelated to insurance
            - Personal advice unrelated to insurance

            CONTEXT BEHAVIOR:
            - Remember conversation history for insurance topics only
            - When users ask follow-up questions about insurance, refer to previous messages
            - Continue insurance conversations naturally
            - REJECT any non-insurance questions immediately

            FORMATTING for WhatsApp:
            - Use emojis appropriately 😊🚗🏥💰
            - Keep paragraphs short (2-3 lines max)
            - Use bullet points with • symbol when listing
            - Be conversational and friendly for insurance topics only
            
            ALLOWED TOPICS ONLY:
            1. Insurance in Lebanon (auto, health, property, life)
            2. Car market prices in Lebanon
            3. Car comparisons and recommendations
            4. Lebanese insurance laws and regulations
            5. Ammin's services and benefits
            6. Elias Chedid Hanna (founder information)
            7. Insurance quotes and coverage options
            
            Support both English and Arabic for insurance topics only.`
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
    
    console.log('OpenAI response received successfully');
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    return "مرحباً! أنا مساعد أمّن للتأمين. كيف يمكنني مساعدتك اليوم؟\n\nHello! I'm Ammin's insurance assistant. How can I help you today? 😊";
  }
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, message) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
    throw new Error('WhatsApp configuration missing');
  }

  try {
    console.log(`📤 Sending message to ${to}: ${message.substring(0, 50)}...`);
    
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

    console.log('✅ Message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

// ADMIN DASHBOARD - Simple page for your company to see users
app.get('/admin', (req, res) => {
  const users = [];
  
  for (const [userId, data] of userAnalytics.entries()) {
    users.push({
      phoneNumber: userId,
      firstContact: data.firstContact,
      lastSeen: data.lastSeen,
      totalMessages: data.totalMessages,
      topics: data.topics.join(', ') || 'No topics yet',
      lastMessage: data.recentMessages[data.recentMessages.length - 1]?.message || 'No messages'
    });
  }
  
  // Sort by most recent
  users.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp Bot Users - Ammin Insurance</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            h1 { color: #1877f2; text-align: center; }
            .stats { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
            .user-card { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #1877f2; }
            .phone { font-weight: bold; color: #1877f2; }
            .time { color: #666; font-size: 0.9em; }
            .topics { background: #e3f2fd; padding: 5px 10px; border-radius: 15px; display: inline-block; margin: 5px 0; }
            .refresh { background: #1877f2; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
        </style>
        <script>
            function refreshPage() { location.reload(); }
            setInterval(refreshPage, 30000); // Auto refresh every 30 seconds
        </script>
    </head>
    <body>
        <h1>📱 WhatsApp Bot Users - Ammin Insurance</h1>
        
        <div class="stats">
            <h3>📊 Summary</h3>
            <p><strong>Total Users:</strong> ${users.length}</p>
            <p><strong>Active Today:</strong> ${users.filter(u => 
              new Date(u.lastSeen) > new Date(Date.now() - 24*60*60*1000)
            ).length}</p>
            <button class="refresh" onclick="refreshPage()">🔄 Refresh Now</button>
        </div>
        
        <h3>👥 Users Who Texted the Bot</h3>
        ${users.map(user => `
          <div class="user-card">
            <div class="phone">📞 ${user.phoneNumber}</div>
            <div class="time">⏰ Last seen: ${new Date(user.lastSeen).toLocaleString()}</div>
            <div class="time">📅 First contact: ${new Date(user.firstContact).toLocaleString()}</div>
            <div>💬 Total messages: ${user.totalMessages}</div>
            <div>💭 Last message: ${user.lastMessage}</div>
            <div class="topics">🏷️ Topics: ${user.topics}</div>
          </div>
        `).join('')}
        
        <div style="text-align: center; margin-top: 30px; color: #666;">
            <p>🤖 This page auto-refreshes every 30 seconds</p>
            <p>📊 Real-time data from your WhatsApp chatbot</p>
        </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'CorporateAI WhatsApp Bot',
    activeConversations: conversationMemory.size,
    totalUsers: userAnalytics.size,
    environment: {
      hasWhatsAppToken: !!WHATSAPP_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      hasOpenAIKey: !!OPENAI_API_KEY,
      hasVerifyToken: !!VERIFY_TOKEN
    }
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
      lastInsuranceMessage: data.lastInsuranceMessage,
      recentMessages: data.messages.slice(-3).map(msg => ({
        role: msg.role,
        content: msg.content.substring(0, 100) + '...',
        timestamp: new Date(msg.timestamp).toISOString()
      }))
    });
  }
  res.json({
    totalConversations: conversations.length,
    conversations: conversations
  });
});

// Start server
app.listen(port, () => {
  console.log(`🤖 CorporateAI WhatsApp Bot server running on port ${port}`);
  console.log(`📱 Webhook URL: /webhook`);
  console.log(`✅ Health check: /health`);
  console.log(`👥 Admin dashboard: /admin`);
  console.log(`🧠 Conversation memory enabled`);
  console.log(`🔧 Debug endpoint: /debug/conversations`);
  console.log(`🔑 Environment check:`);
  console.log(`   - WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.log(`   - PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`   - OPENAI_API_KEY: ${OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   - VERIFY_TOKEN: ${VERIFY_TOKEN ? '✅ Set' : '❌ Missing'}`);
});

module.exports = app;
