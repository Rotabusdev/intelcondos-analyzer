// Servidor de análise de documentos com Google Document AI
// api/index.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('Webhook received! Using Document AI architecture.');

  const { record: newDocument } = req.body;
  if (!newDocument || !newDocument.id) {
    return res.status(400).send('Document ID is missing');
  }
  const documentId = newDocument.id;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  try {
    console.log(`Starting analysis for document: ${documentId}`);
    
    // --- BUSCA DO ARQUIVO ---
    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id')
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
    
    // --- CHAMADA PARA O GOOGLE DOCUMENT AI ---
    console.log('Extracting text and structure with Google Document AI...');
    const docAIClient = new DocumentProcessorServiceClient();
    
    const name = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.GCP_PROCESSOR_ID}`;

    const request = {
      name: name,
      rawDocument: {
        content: base64,
        mimeType: 'application/pdf',
      },
    };

    const [result] = await docAIClient.processDocument(request);
    const { text } = result.document;

    if (!text) {
      throw new Error('Document AI did not extract any text.');
    }

    // --- CHAMADA PARA A OPENAI COM TEXTO DE ALTA QUALIDADE ---
    console.log(`Text extracted! Length: ${text.length}. Analyzing with OpenAI...`);
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12 ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.` },
          { role: 'user', content: `Analise este documento financeiro de condomínio:\n\n${text}` }
        ],
        temperature: 0.1
      },
      { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const analysisText = openaiResponse.data.choices[0].message.content;
    
    let jsonString = analysisText;
    const jsonMatch = analysisText.match(/\{[\sS]*\}/);
    if (jsonMatch) {
      jsonString = jsonMatch[0];
    }
    const financialData = JSON.parse(jsonString);

    // --- SALVANDO O RESULTADO ---
    console.log('Creating financial data record...');
    await supabase.from('financial_analysis').insert({
      condominium_id: document.condominium_id,
      document_upload_id: document.id,
      ...financialData
    });

    await supabase.from('document_uploads').update({
      analysis_status: 'completed',
      analyzed_at: new Date().toISOString()
    }).eq('id', documentId);

    console.log('Analysis completed successfully using Document AI architecture');
    res.status(200).send({ success: true, message: 'Analysis completed successfully' });

  } catch (error) {
    console.error("Analysis error:", error.response?.data || error.stack || error.message);
    await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", documentId);
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;