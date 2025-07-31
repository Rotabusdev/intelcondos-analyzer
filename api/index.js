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
  console.log('Webhook received! Using production architecture.!'); // Forçando redeploy

  const { record: newDocument } = req.body;
  if (!newDocument || !newDocument.id) {
    return res.status(400).send('Document ID is missing');
  }
  const documentId = newDocument.id;

  // Inicializa o Supabase Client fora do try/catch para poder usá-lo no bloco catch
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  
  try {
    // --- CONFIGURAÇÃO DA CONTA DE SERVIÇO DO GOOGLE (MÉTODO BASE64) ---
    const base64Key = process.env.GCP_SA_KEY_B64;

    // VERIFICAÇÃO DE SEGURANÇA: Garante que a variável de ambiente existe antes de usá-la.
    if (!base64Key) {
      console.error("ERRO CRÍTICO: A variável de ambiente GCP_SA_KEY não foi encontrada ou está vazia.");
      // Lança um erro claro que será capturado pelo bloco catch.
      throw new Error("Configuração de credenciais do Google (GCP_SA_KEY) ausente no ambiente.");
    }
    
    // Decodifica a chave Base64 para o conteúdo JSON.
    const jsonKeyContent = Buffer.from(base64Key, 'base64').toString('utf8');
    
    // A Vercel permite escrever arquivos temporários no diretório /tmp.
    const keyFilePath = path.join('/tmp', 'gcp_key.json');
    fs.writeFileSync(keyFilePath, jsonKeyContent);
    
    // Aponta a variável de ambiente padrão da Google para o arquivo de chave temporário.
    // As bibliotecas do Google Cloud encontrarão e usarão este arquivo automaticamente.
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
    // Inicializa o cliente do Document AI. Ele usará as credenciais definidas
    // na variável de ambiente GOOGLE_APPLICATION_CREDENTIALS.
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
          { role: 'system', content: `Você é um especialista em análise de documentos financeiros de condomínios. Analise o texto extraído e retorne APENAS um JSON válido com os seguintes campos: {"total_revenue": número,"total_expenses": número,"reserve_fund": número,"default_amount": número,"cost_per_unit": número,"personnel_expense_percentage": número,"reference_month": número (1-12  ),"reference_year": número}. Extraia apenas valores numéricos reais do documento. Se um campo não for encontrado, use 0.` },
          { role: 'user', content: `Analise este documento financeiro de condomínio:\n\n${text}` }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" } // Garante que a resposta seja JSON
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
    // Garante que o status seja atualizado para 'failed' em caso de qualquer erro no bloco try
    await supabase.from("document_uploads").update({ analysis_status: "failed" }).eq("id", documentId);
    res.status(500).send({ success: false, error: error.message });
  }
});

module.exports = app;