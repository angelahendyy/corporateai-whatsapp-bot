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

// Insurance keywords for filtering
const INSURANCE_KEYWORDS = [
  'insurance', 'policy', 'premium', 'deductible', 'claim', 'coverage',
  'car', 'vehicle', 'auto', 'accident', 'price', 'cost', 'lebanon',
  'ammin', 'تأمين', 'سيارة', 'حادث', 'سعر', 'امّن', 'لبنان'
];

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
  const messageBody = message.text?.body?.toLowerCase();
  const messageType = message.type;

  console.log(`Received message from ${from}: ${messageBody}`);

  // Only respond to text messages
  if (messageType !== 'text') {
    await sendWhatsAppMessage(from, "مرحباً! أنا CorporateAI، مساعد أمّن للتأمين. أرسل لي رسالة نصية وسأساعدك! 🤖\n\nHello! I'm CorporateAI, Ammin's insurance assistant. Send me a text message and I'll help you! 🤖");
    return;
  }

  // Check if message is insurance-related
  if (!isInsuranceRelated(messageBody)) {
    await sendWhatsAppMessage(from, 
      "أنا متخصص في مواضيع التأمين في لبنان فقط، خاصة لشركة أمّن للتأمين. هل يمكنك سؤالي عن شيء متعلق بالتأمين؟ 🏥🚗\n\nI'm specialized in Lebanese insurance topics only, particularly for Ammin insurance company. Could you please ask me something related to insurance? 🏥🚗"
    );
    return;
  }

  // Handle special queries
  if (await handleSpecialQueries(from, messageBody)) {
    return;
  }

  // Get AI response
  const aiResponse = await getOpenAIResponse(messageBody);
  
  if (aiResponse) {
    await sendWhatsAppMessage(from, aiResponse);
  } else {
    await sendWhatsAppMessage(from, "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.\nSorry, there was an error. Please try again.");
  }
}

// Check if message is insurance-related
function isInsuranceRelated(message) {
  // Always allow greetings
  const greetings = ['hi', 'hello', 'hey', 'مرحبا', 'أهلا', 'سلام'];
  if (greetings.some(greeting => message.includes(greeting))) {
    return true;
  }

  // Check insurance keywords
  return INSURANCE_KEYWORDS.some(keyword => message.includes(keyword));
}

// Handle special queries (Elias, Ammin info, etc.)
async function handleSpecialQueries(from, message) {
  // Elias Chedid Hanna queries
  if (message.includes('elias') || message.includes('chedid') || message.includes('hanna') || 
      message.includes('الياس') || message.includes('شديد') || message.includes('حنا')) {
    
    const isArabic = /[\u0600-\u06FF]/.test(message);
    const response = isArabic ? 
      "الياس شديد حنا هو مؤسس ومالك شركة أمّن للتأمين في لبنان. تحت قيادته، نمت شركة أمّن لتصبح واحدة من أكثر شركات التأمين موثوقية في لبنان 🏆" :
      "Elias Chedid Hanna is the founder and owner of Ammin Insurance Company in Lebanon. Under his leadership, Ammin has grown to become one of the most reliable insurance providers in Lebanon 🏆";
    
    await sendWhatsAppMessage(from, response);
    return true;
  }

  // Ammin company info
  if (message.includes('what is ammin') || message.includes('about ammin') || 
      message.includes('ما هي أمين') || message.includes('ما هي امن')) {
    
    const response = "🏢 AMMIN is an online platform licensed by the International Insurance Commission (ICC), led by Mr. Elie Hanna and his exceptional team.\n\n✨ We simplify the insurance experience for individuals and businesses in Lebanon, providing:\n• Centralized insurance platform\n• Licensed professional brokers\n• Partnerships with top insurance companies\n• User-friendly mobile app\n\n📱 Download our app: https://play.google.com/store/apps/details?id=com.ammin.ammin";
    
    await sendWhatsAppMessage(from, response);
    return true;
  }

  return false;
}

// Get response from OpenAI (optional - works without API key)
async function getOpenAIResponse(message) {
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
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system", 
            content: `You are CorporateAI, a friendly WhatsApp insurance assistant for Ammin, a Lebanese insurance company owned by Elias Chedid Hanna.

            IMPORTANT: Format responses for WhatsApp chat:
            - Use emojis to make messages friendly 😊🚗🏥💰
            - Keep paragraphs short (2-3 lines max)
            - Use bullet points with • symbol
            - Add line breaks for readability
            - Be conversational and friendly like chatting with a friend
            
            Respond about:
            1. Insurance in Lebanon (auto, health, property)
            2. Car market prices in Lebanon
            3. Car comparisons and recommendations
            4. Lebanese insurance laws
            5. Ammin's services and benefits
            6. Elias Chedid Hanna (founder)
            
            Support both English and Arabic. Keep responses under 1000 characters when possible.
            Always end with a helpful question or suggestion.`
          },
          { role: "user", content: message }
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
    service: 'CorporateAI WhatsApp Bot'
  });
});

// Start server
app.listen(port, () => {
  console.log(`🤖 CorporateAI WhatsApp Bot server running on port ${port}`);
  console.log(`📱 Webhook URL will be available soon`);
  console.log(`✅ Health check: /health`);
});

module.exports = app;
