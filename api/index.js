// Servidor de análise de documentos
// api/index.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('Webhook received!');

  const { record: newDocument } = req.body;
  console.log('Payload received:', JSON.stringify(req.body, null, 2));
  if (!newDocument || !newDocument.id) {
    console.error('Document ID not found in webhook payload');
    return res.status(400).send('Document ID is missing');
  }
  const documentId = newDocument.id;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log(`Starting analysis for document: ${documentId}`);
    const openaiKey = process.env.OPENAI_API_KEY;
    const visionKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;

    if (!openaiKey || !visionKey) {
      throw new Error('API keys for OpenAI or Google Vision are not set');
    }

    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError) throw docError;

    await supabase.from('document_uploads').update({ analysis_status: 'analyzing' }).eq('id', documentId);

    console.log('Downloading file from Supabase Storage...');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);

    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const base64 = buffer.toString('base64');

    console.log('Extracting text with Google Vision API...');
    const visionResponse = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
      {
        requests: [{
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
      }
     );

    const visionData = visionResponse.data;
    const extractedText = visionData.responses?.[0]?.fullTextAnnotation?.text;

    if (!extractedText) {
      console.error("DEBUG: No text extracted. Full Vision API response:", JSON.stringify(visionData));
      throw new Error('No text extracted from document');
    }

    console.log(`Text extracted! Length: ${extractedText.length}`);
    console.log('Analyzing with OpenAI...');
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12 ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.` },
          { role: 'user', content: `Analise este documento financeiro de condomínio:\n\n${extractedText}` }
        ],
        temperature: 0.1
      },
      { headers: { 'Authorization': `Bearer ${openaiKey}` } }
    );

    const analysisText = openaiResponse.data.choices[0].message.content;
    const financialData = JSON.parse(analysisText);

    console.log('Creating financial data record...');
    await supabase.from('dados_financeiros_processados').insert({
      condominium_id: document.condominium_id,
      period_month: financialData.reference_month,
      period_year: financialData.reference_year,
      total_revenue: financialData.total_revenue,
      total_expenses: financialData.total_expenses,
      reserve_fund: financialData.reserve_fund,
      cost_per_unit: financialData.cost_per_unit,
      personnel_expense_percentage: financialData.personnel_expense_percentage
    });

    await supabase.from('document_uploads').update({
      analysis_status: 'completed',
      analyzed_at: new Date().toISOString()
    }).eq('id', documentId);

    console.log('Analysis completed successfully');
    res.status(200).send({ success: true, message: 'Analysis completed successfully' });

  } catch (error) {
    console.error("Analysis error:", error.stack || error.message);
    await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", documentId);
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;
```4.  Salve o arquivo.`
