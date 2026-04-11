import json
from datetime import datetime
from backend.database import db

class System(db.Model):
    """
    定义机器翻译使用的模型名称（系统）
    """
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)

class Task(db.Model):
    """
    评测任务
    """
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    eval_type = db.Column(db.String(50), nullable=False, default='RR') # RR 或 DA
    language_direction = db.Column(db.String(100), nullable=True) # 语向
    creator = db.Column(db.String(100), nullable=False)
    create_time = db.Column(db.DateTime, default=datetime.utcnow)
    translation_count = db.Column(db.Integer, default=0)
    
    task_systems = db.relationship('TaskSystem', backref='task', cascade='all, delete-orphan')
    segments = db.relationship('Segment', backref='task_parent', cascade='all, delete-orphan')
    annotations = db.relationship('Annotation', backref='task_parent', cascade='all, delete-orphan')

class TaskSystem(db.Model):
    """
    任务对应的译文系统配置
    """
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    system_id = db.Column(db.Integer, db.ForeignKey('system.id'), nullable=False)
    
    system = db.relationship('System')
    targets = db.relationship('TargetSegment', backref='task_system', cascade='all, delete-orphan')

class Segment(db.Model):
    """
    原文片段
    """
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    line_number = db.Column(db.Integer, nullable=False)
    source_text = db.Column(db.Text, nullable=False)
    source_tokens = db.Column(db.Text, nullable=False) # JSON list of tokens

    targets = db.relationship('TargetSegment', backref='segment', cascade='all, delete-orphan')

class TargetSegment(db.Model):
    """
    译文片段
    """
    id = db.Column(db.Integer, primary_key=True)
    segment_id = db.Column(db.Integer, db.ForeignKey('segment.id', ondelete='CASCADE'), nullable=False)
    task_system_id = db.Column(db.Integer, db.ForeignKey('task_system.id', ondelete='CASCADE'), nullable=False)
    target_text = db.Column(db.Text, nullable=False)
    target_tokens = db.Column(db.Text, nullable=False) # JSON list of tokens

class Annotation(db.Model):
    """
    用户对某个译文片段的整体标注（DA、RR、备注）
    """
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.String(100), nullable=False)
    target_segment_id = db.Column(db.Integer, db.ForeignKey('target_segment.id', ondelete='CASCADE'), nullable=False)
    da_score = db.Column(db.Float, nullable=True)
    rr_rank = db.Column(db.Integer, nullable=True)
    remark = db.Column(db.Text, nullable=True)

    errors = db.relationship('ErrorAnnotation', backref='annotation', cascade='all, delete-orphan')

    __table_args__ = (db.UniqueConstraint('user_id', 'target_segment_id', name='_user_target_uc'),)

class ErrorAnnotation(db.Model):
    """
    具体的词级别错误标注
    """
    id = db.Column(db.Integer, primary_key=True)
    annotation_id = db.Column(db.Integer, db.ForeignKey('annotation.id', ondelete='CASCADE'), nullable=False)
    start_idx = db.Column(db.Integer, nullable=False)
    end_idx = db.Column(db.Integer, nullable=False)
    error_type = db.Column(db.String(50), nullable=False)
    severity = db.Column(db.Integer, nullable=False, default=1) # 1: 轻度(绿), 2: 中度(黄), 3: 重度(红)
