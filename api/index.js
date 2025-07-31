// Versão de Produção Final e Segura
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('Webhook received! Using production architecture.');

  const { record: newDocument } = req.body;
  if (!newDocument || !newDocument.id) {
    return res.status(400).send('Document ID is missing');
  }
  const documentId = newDocument.id;

  // Inicializa o Supabase Client com opções para o ambiente Vercel (data-proxy)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { db: { schema: 'public' }, auth: { autoRefreshToken: false, persistSession: false } }
  );
  
  try {
    // --- CONFIGURAÇÃO DA CONTA DE SERVIÇO DO GOOGLE (MÉTODO BASE64) ---
    const base64Key = process.env.GCP_SA_KEY_B64; // <-- USA A VARIÁVEL CORRETA
    if (!base64Key) {
      throw new Error("Configuração de credenciais do Google (GCP_SA_KEY_B64) ausente no ambiente.");
    }
    
    // Decodifica a chave Base64 para o conteúdo JSON.
    const jsonKeyContent = Buffer.from(base64Key, 'base64').toString('utf8');
    
    const keyFilePath = path.join('/tmp', 'gcp_key.json');
    fs.writeFileSync(keyFilePath, jsonKeyContent);
    
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
    // --- FIM DA CONFIGURAÇÃO ---

    console.log(`Starting analysis for document: ${documentId}`);
    
    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id, file_type')
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
    const encodedFile = buffer.toString('base64');
    
    console.log('Extracting text with Google Document AI...');
    const docAIClient = new DocumentProcessorServiceClient();
    
    const name = `projects/${process.env.GCP_PROJECT_ID}/locations/${process.env.GCP_LOCATION}/processors/${process.env.GCP_PROCESSOR_ID}`;
    const request = {
      name: name,
      rawDocument: {
        content: encodedFile,
        mimeType: document.file_type || 'application/pdf',
      },
    };

    const [result] = await docAIClient.processDocument(request);
    const { text } = result.document;

    if (!text) {
      throw new Error('Document AI did not extract any text.');
    }

    console.log(`Text extracted! Length: ${text.length}. Analyzing with OpenAI...`);
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12   ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.` },
          { role: 'user', content: `Analise este documento financeiro de condomínio:\n\n${text}` }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      },
      { headers: { 'Authorization': `Bearer ${openaiKey}` } }
    );

    const analysisResult = openaiResponse.data.choices[0].message.content;
    const financialData = JSON.parse(analysisResult);

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

    console.log('Analysis completed successfully');
    res.status(200).send({ success: true, message: 'Analysis completed successfully' });

  } catch (error) {
    console.error("Analysis error:", error.response?.data || error.stack || error.message);
    await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", documentId);
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;