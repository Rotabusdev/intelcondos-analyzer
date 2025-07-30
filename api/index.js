// api/index.js

// Importa as funções e o cliente Supabase. Os nomes dos arquivos foram corrigidos para incluir '.js'.
import createClient from '@supabase/supabase-js'; 
import extractTextFromPdfBuffer from './documentAI.js'; 
import analyzeFinancialText from './openAI.js'; 

// Adicionado para fins de depuração: para ver se a função é carregada pelo Vercel.
console.log('API: Função index.js carregada.');

export default async function handler(req, res) {
  console.log('API: Requisição recebida. Método:', req.method); // Log para cada requisição recebida

  // Verifica se o método da requisição é POST.
  if (req.method !== 'POST') {
    console.log('API: Método não permitido. Retornando 405.'); 
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // Bloco try-catch para capturar e logar erros internos da função.
  try {
    console.log('API: Requisição POST recebida. Iniciando processamento.'); 
    const record = req.body;

    // Verifica se o ID do documento está presente no corpo da requisição.
    if (!record?.id) {
      console.error('API: Document ID ausente na requisição. Retornando 400.'); 
      return res.status(400).json({ error: 'Document ID is missing' });
    }

    const documentId = record.id;
    console.log(`API: Processando documento com ID: ${documentId}`); 

    // Inicializa o cliente Supabase.
    // Certifique-se de que SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY estão definidos nas Vercel Environment Variables.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error('API: Variáveis de ambiente Supabase não configuradas.');
      return res.status(500).json({ error: 'Configuração do Supabase ausente.' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    console.log('API: Cliente Supabase inicializado.');

    // Busca o documento no Supabase.
    const { data: documentData, error: fetchError } = await supabase
      .from('document_uploads')
      .select('file_content')
      .eq('id', documentId)
      .single();

    if (fetchError) {
      console.error('API: Erro ao buscar documento no Supabase:', fetchError);
      return res.status(500).json({ error: 'Erro ao buscar documento.', details: fetchError.message });
    }

    if (!documentData || !documentData.file_content) {
      console.error('API: Documento não encontrado ou sem conteúdo para ID:', documentId);
      return res.status(404).json({ error: 'Documento não encontrado ou sem conteúdo.' });
    }

    console.log('API: Documento encontrado no Supabase. Extraindo texto...');

    // Extrai o texto do PDF.
    const extractedText = await extractTextFromPdfBuffer(documentData.file_content);
    
    if (!extractedText) {
      console.error('API: Nenhum texto extraído do documento.');
      return res.status(500).json({ error: 'Nenhum texto pôde ser extraído do documento.' });
    }

    console.log('API: Texto extraído com sucesso. Analisando financeiramente...');

    // Analisa o texto com OpenAI.
    // Certifique-se de que OPENAI_API_KEY está definida nas Vercel Environment Variables.
    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      console.error('API: Variável de ambiente OPENAI_API_KEY não configurada.');
      return res.status(500).json({ error: 'Chave da OpenAI ausente.' });
    }

    const financialAnalysis = await analyzeFinancialText(extractedText, openAIKey);
    console.log('API: Análise financeira concluída.');

    // Insere o resultado da análise no Supabase.
    const { data: insertData, error: insertError } = await supabase
      .from('financial_analysis')
      .insert({
        document_upload_id: documentId,
        analysis_status: 'completed', // Assumindo que a análise foi bem-sucedida
        // Adicione aqui outros campos do financialAnalysis conforme a estrutura da sua tabela
        total_revenues: financialAnalysis.total_revenues,
        total_expenses: financialAnalysis.total_expenses,
        reserve_fund: financialAnalysis.reserve_fund,
        default_amount: financialAnalysis.default_amount,
        cost_per_unit: financialAnalysis.cost_per_unit,
        personnel_expense_percentage: financialAnalysis.personnel_expense_percentage,
        reference_month: financialAnalysis.reference_month,
        reference_year: financialAnalysis.reference_year
      });

    if (insertError) {
      console.error('API: Erro ao inserir análise no Supabase:', insertError);
      return res.status(500).json({ error: 'Erro ao salvar análise.', details: insertError.message });
    }

    console.log('API: Análise salva no Supabase. Resposta final enviada.');
    return res.status(200).json({
      message: 'Documento processado e analisado com sucesso!',
      analysisId: insertData?.[0]?.id || 'N/A', // Assumindo que o insert retorna o ID
      financialAnalysis: financialAnalysis
    });

  } catch (error) {
    console.error('API: Erro inesperado durante o processamento:', error.message, error.stack); 
    return res.status(500).json({ error: 'Erro interno do servidor. Consulte os logs para mais detalhes.', details: error.message });
  }
}