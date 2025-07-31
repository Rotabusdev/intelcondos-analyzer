// index.js - VERSÃO FINAL LENDO A CHAVE DO SUPABASE
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

const app = express();
app.use(express.json());

// Função assíncrona para inicializar o cliente do Google
async function initializeDocAIClient() {
  // 1. Cria um cliente Supabase SÓ para buscar a chave.
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 2. Busca a chave secreta da sua nova tabela.
  console.log("Buscando a chave secreta do Supabase...");
  const { data: secret, error } = await supabaseAdmin
    .from('app_secrets')
    .select('value')
    .eq('name', 'gcp_service_account_key')
    .single();

  if (error || !secret) {
    console.error("Erro ao buscar a chave do Supabase:", error);
    throw new Error("FATAL: Não foi possível carregar a chave de serviço do Google a partir do Supabase.");
  }
  console.log("Chave secreta do Supabase carregada com sucesso.");

  // 3. A chave já vem como um objeto JSON, pronta para ser usada.
  const credentials = secret.value;

  // 4. Retorna um cliente do Document AI devidamente autenticado.
  return new DocumentProcessorServiceClient({ credentials });
}


app.post('/api', async (req, res) => {
  try {
    // A inicialização agora acontece dentro da requisição
    const docAIClient = await initializeDocAIClient();
    
    console.log('Webhook received! Using production architecture. Final version.');

    if (!req.body || !req.body.record || !req.body.record.id) {
      console.error('Invalid webhook payload received.');
      return res.status(400).send('Invalid webhook payload: Document ID is missing');
    }
    const documentId = req.body.record.id;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { db: { schema: 'public' }, auth: { autoRefreshToken: false, persistSession: false } }
    );
    
    console.log(`Starting analysis for document: ${documentId}`);
    
    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id, file_type')
      .eq('id', documentId)
      .single();

    if (docError) throw new Error(`Error fetching document from Supabase: ${docError.message}`);
    if (!document) throw new Error(`Document with ID ${documentId} not found.`);

    await supabase.from('document_uploads').update({ analysis_status: 'analyzing' }).eq('id', documentId);

    console.log('Downloading file from Supabase Storage...');
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);
    if (downloadError) throw new Error(`Error downloading file from Supabase: ${downloadError.message}`);
    
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const encodedFile = buffer.toString('base64');
    
    console.log('Extracting text with Google Document AI...');
    
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
          { role: 'system', content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12  ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.` },
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
    console.error("Analysis error:", error.stack || error.message);
    if (req.body && req.body.record && req.body.record.id) {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", req.body.record.id);
    }
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;