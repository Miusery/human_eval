import jieba
from textblob import TextBlob
import re

def is_chinese(text):
    """
    判断文本是否包含中文字符，如果包含则使用 jieba 分词，否则使用 TextBlob
    """
    if re.search(r'[\u4e00-\u9fa5]', text):
        return True
    return False

def tokenize(text):
    """
    对文本进行分词，返回词汇列表
    """
    text = text.strip()
    if not text:
        return []
    
    if is_chinese(text):
        # 使用 jieba 进行中文分词
        return list(jieba.cut(text))
    else:
        # 使用 TextBlob 进行英文分词
        from textblob import TextBlob
        tb = TextBlob(text)
        return tb.words # textblob tokenizer

def align_and_tokenize(source_lines, target_lines_list):
    """
    校验行数是否严格对齐，并进行分词
    source_lines: list of str
    target_lines_list: list of (list of str)
    
    返回: (source_data, target_data_list)
    """
    num_lines = len(source_lines)
    for i, t_lines in enumerate(target_lines_list):
        if len(t_lines) != num_lines:
            raise ValueError(f"译文 {i+1} 的行数 ({len(t_lines)}) 与原文行数 ({num_lines}) 不严格对应！")
            
    source_data = []
    for line in source_lines:
        source_data.append({
            'text': line,
            'tokens': tokenize(line)
        })
        
    target_data_list = []
    for t_lines in target_lines_list:
        t_data = []
        for line in t_lines:
            t_data.append({
                'text': line,
                'tokens': tokenize(line)
            })
        target_data_list.append(t_data)
        
    return source_data, target_data_list
